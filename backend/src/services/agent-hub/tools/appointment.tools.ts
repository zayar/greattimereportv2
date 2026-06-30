import { z } from "zod";
import { env } from "../../../config/env.js";
import {
  buildApicoreBookingDetailsDateRange,
  isApicoreBookingWallClockDateInRange,
} from "../../apicore-booking-details-range.js";
import { runWithAnalyticsQueryContext } from "../../analytics-query-context.js";
import { fetchApicoreBookingDetails, type ApicoreBookingDetailsRow } from "../../apicore.service.js";
import { getServiceBehaviorReport } from "../../reports/service-behavior.service.js";
import { normalizeAppointmentLifecycle } from "../appointment-lifecycle.js";
import {
  fetchLiveAppointmentSnapshot,
  isActiveCheckedInAppointment,
  isCountableTodayAppointment,
  liveAppointmentEntityRef,
  type LiveAppointmentRow,
} from "../appointment-live.service.js";
import { normalizeTimeZone } from "../../telegram/time.js";
import { buildCustomerKey } from "../customer-identity.js";
import { limitRows, maskPhone, nowIso, sanitizeError } from "../safety.js";
import {
  buildSnapshotStaleWarning,
  factSnapshotToAgentSource,
  getFactSnapshotForPeriod,
  getFreshFactSnapshot,
  isCompletedHistoricalDay,
} from "../snapshot-cache.service.js";
import type { GtAgentFactSnapshot } from "../memory/memory-types.js";
import type { AgentDataStatus, AgentToolDefinition, AgentToolInput, AgentToolResult } from "../types.js";

const toolInputSchema = z.custom<AgentToolInput>(() => true);
const LEDGER_PAGE_SIZE = 200;
const LEDGER_MAX_FETCH_ROWS = 1_000;
const LEDGER_TABLE_ROWS = 30;
const OPEN_TREATMENT_STATUSES = new Set(["REQUEST", "REQUESTED", "BOOKED", "BOOKING", "CHECKIN", "CHECK_IN"]);
const CHECKED_IN_LEDGER_STATUSES = new Set(["CHECKIN", "CHECK_IN"]);

type AppointmentToolDeps = {
  getCompletedDayAppointmentProfileSnapshot: typeof getCompletedDayAppointmentProfileSnapshot;
  getOperationalAppointmentSnapshot: typeof getOperationalAppointmentSnapshot;
  fetchLiveSnapshot: typeof snapshot;
};

function runAppointmentBigQueryOperation<T>(params: {
  toolName: string;
  operationName: string;
  callback: () => Promise<T>;
}) {
  return runWithAnalyticsQueryContext(
    {
      queryNamePrefix: `agent.appointment.${params.toolName}.${params.operationName}`,
      labels: {
        app: "greattime",
        feature: "agent_hub",
        agent: "appointment",
        tool: params.toolName,
        operation: params.operationName,
      },
      timeoutMs: env.AGENT_BIGQUERY_TIMEOUT_MS,
      ttlMs: env.BQ_QUERY_DEFAULT_TTL_MS,
      readOnly: true,
    },
    params.callback,
  );
}

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

function normalizeText(value: string | null | undefined, fallback = "Unknown") {
  const text = value?.trim();
  return text || fallback;
}

function normalizeStatus(value: string | null | undefined) {
  return value?.trim().toUpperCase().replace(/[\s-]+/g, "_") ?? "";
}

function isCancelledNoShowOrCancelledStatus(row: Pick<LiveAppointmentRow, "rawStatus" | "lifecycleState">) {
  const status = normalizeStatus(row.rawStatus);
  return (
    row.lifecycleState === "cancelled" ||
    row.lifecycleState === "no_show" ||
    status === "MERCHANT_CANCEL" ||
    status === "MEMBER_CANCEL" ||
    status === "CANCEL" ||
    status === "CANCELLED" ||
    status === "NO_SHOW" ||
    status === "NOSHOW"
  );
}

function isNotCheckedOutAppointment(row: LiveAppointmentRow) {
  return row.lifecycleState !== "checked_out" && !isCancelledNoShowOrCancelledStatus(row);
}

function isScheduledLiveRow(row: Pick<LiveAppointmentRow, "sourceType">) {
  return row.sourceType === "booking" || row.sourceType === "merged";
}

function periodLabel(input: AgentToolInput) {
  return input.period.fromDate === input.period.toDate
    ? input.period.fromDate
    : `${input.period.fromDate} to ${input.period.toDate}`;
}

function ledgerTableRows(rows: ApicoreBookingDetailsRow[]) {
  return rows.map((row) => {
    const lifecycle = normalizeAppointmentLifecycle({ rawStatus: row.status });

    return {
      appointmentId: row.bookingid,
      scheduledFrom: row.FromTime,
      scheduledTo: row.ToTime,
      customerName: normalizeText(row.MemberName),
      customerPhoneMasked: maskPhone(row.MemberPhoneNumber),
      serviceName: normalizeText(row.ServiceName),
      practitionerName: normalizeText(row.PractitionerName),
      helperName: normalizeText(row.HelperName, ""),
      rawStatus: row.status,
      lifecycleState: lifecycle.state,
    };
  });
}

function ledgerTable(title: string, rows: ApicoreBookingDetailsRow[]) {
  return {
    title,
    columns: [
      { key: "scheduledFrom", title: "Time" },
      { key: "customerName", title: "Customer" },
      { key: "customerPhoneMasked", title: "Phone" },
      { key: "serviceName", title: "Service" },
      { key: "practitionerName", title: "Practitioner" },
      { key: "rawStatus", title: "Status" },
      { key: "helperName", title: "Helper" },
    ],
    rows: ledgerTableRows(limitRows(rows, LEDGER_TABLE_ROWS)),
  };
}

function appointmentServiceRows(rows: ApicoreBookingDetailsRow[]) {
  const grouped = new Map<string, { serviceName: string; appointmentCount: number; customerNames: Set<string> }>();

  rows.forEach((row) => {
    const serviceName = normalizeText(row.ServiceName, "Unknown service");
    const current =
      grouped.get(serviceName) ??
      {
        serviceName,
        appointmentCount: 0,
        customerNames: new Set<string>(),
      };

    current.appointmentCount += 1;
    current.customerNames.add(normalizeText(row.MemberName, "Unknown customer"));
    grouped.set(serviceName, current);
  });

  return [...grouped.values()]
    .map((row) => ({
      serviceName: row.serviceName,
      appointmentCount: row.appointmentCount,
      customerCount: row.customerNames.size,
    }))
    .sort((left, right) => {
      if (right.appointmentCount !== left.appointmentCount) {
        return right.appointmentCount - left.appointmentCount;
      }

      return left.serviceName.localeCompare(right.serviceName);
    });
}

function appointmentServiceTable(rows: ApicoreBookingDetailsRow[]) {
  return {
    title: "Appointment services",
    columns: [
      { key: "serviceName", title: "Service" },
      { key: "appointmentCount", title: "Appointments" },
      { key: "customerCount", title: "Customers" },
    ],
    rows: appointmentServiceRows(rows),
  };
}

function appointmentLedgerEntityRef(row: ApicoreBookingDetailsRow, rank: number) {
  return {
    entityType: "appointment" as const,
    entityId: row.bookingid,
    appointmentId: row.bookingid,
    appointmentTime: row.FromTime,
    appointmentStatus: row.status,
    customerKey: buildCustomerKey({
      clinicCode: row.ClinicCode,
      phoneNumber: row.MemberPhoneNumber,
      customerName: row.MemberName,
    }),
    displayName: normalizeText(row.MemberName),
    customerName: normalizeText(row.MemberName),
    customerPhone: row.MemberPhoneNumber,
    customerPhoneMasked: maskPhone(row.MemberPhoneNumber),
    serviceName: normalizeText(row.ServiceName),
    practitionerName: normalizeText(row.PractitionerName),
    rank,
  };
}

async function fetchAppointmentLedger(input: AgentToolInput) {
  const checkedAt = nowIso();
  const range = buildAppointmentLedgerQueryRange(input);
  const warnings: NonNullable<AgentToolResult["warnings"]> = [];
  const rows: ApicoreBookingDetailsRow[] = [];
  let sourceTotalCount = Number.POSITIVE_INFINITY;
  let loadedSourceRows = 0;
  let skip = 0;
  let dataStatus: AgentDataStatus = "ok";
  let mismatchedRows = 0;

  while (loadedSourceRows < sourceTotalCount && rows.length < LEDGER_MAX_FETCH_ROWS) {
    const take = Math.min(LEDGER_PAGE_SIZE, LEDGER_MAX_FETCH_ROWS - rows.length);
    const result = await fetchApicoreBookingDetails({
      clinicCode: input.clinic.clinicCode,
      startDate: range.startIso,
      endDate: range.endIso,
      skip,
      take,
      authorizationHeader: input.requestContext.authorizationHeader,
      readOnly: true,
    });

    sourceTotalCount = result.totalCount;
    loadedSourceRows += result.data.length;

    const filteredRows = result.data.filter((row) => {
      const matchesClinic =
        row.ClinicID === input.clinic.clinicId &&
        row.ClinicCode.toLowerCase() === input.clinic.clinicCode.toLowerCase();
      if (!matchesClinic) {
        mismatchedRows += 1;
      }
      return matchesClinic && isApicoreBookingWallClockDateInRange(row.FromTime, input.period.fromDate, input.period.toDate);
    });

    rows.push(...filteredRows);

    if (result.data.length === 0) {
      break;
    }

    skip += result.data.length;
  }

  if (mismatchedRows > 0) {
    warnings.push({
      type: "clinic_context_mismatch",
      title: "Clinic context mismatch",
      message: "Some booking rows did not match the authorized clinic and were excluded.",
    });
  }

  const totalCount = rows.length;

  if (rows.length >= LEDGER_MAX_FETCH_ROWS && loadedSourceRows < sourceTotalCount) {
    dataStatus = rows.length > 0 ? "partial" : "no_activity";
    warnings.push({
      type: "appointment_ledger_truncated",
      title: "Appointment ledger limited",
      message: `The source returned more than ${rows.length.toLocaleString("en-US")} matching appointments, and the agent loaded the first ${rows.length.toLocaleString("en-US")} rows for detail.`,
    });
  } else if (totalCount === 0) {
    dataStatus = "no_activity";
  }

  rows.sort((left, right) => new Date(left.FromTime).getTime() - new Date(right.FromTime).getTime());

  return {
    checkedAt,
    totalCount,
    rows,
    dataStatus,
    warnings,
  };
}

export function buildAppointmentLedgerQueryRange(input: Pick<AgentToolInput, "period" | "request">) {
  const timezone = normalizeTimeZone(input.request.timezone);
  const range = buildApicoreBookingDetailsDateRange({
    fromDate: input.period.fromDate,
    toDate: input.period.toDate,
    timezone,
  });

  return {
    startIso: range.startIso,
    endIso: range.endIso,
    timezone,
  };
}

function ledgerStatusMetrics(rows: ApicoreBookingDetailsRow[], totalCount: number) {
  const distinctServices = appointmentServiceRows(rows).length;
  const counts = rows.reduce(
    (summary, row) => {
      const status = normalizeStatus(row.status);
      if (status === "CHECKOUT" || status === "CHECKED_OUT") {
        summary.checkedOut += 1;
      } else if (status === "NO_SHOW") {
        summary.noShow += 1;
      } else if (status === "MERCHANT_CANCEL" || status === "MEMBER_CANCEL" || status === "CANCEL") {
        summary.cancelled += 1;
      } else {
        summary.open += 1;
      }

      return summary;
    },
    { open: 0, checkedOut: 0, cancelled: 0, noShow: 0 },
  );

  const helperText = rows.length < totalCount ? `Status counts are based on ${rows.length.toLocaleString("en-US")} loaded rows.` : undefined;

  return [
    { label: "Appointments", value: totalCount, helperText: "APICORE booking ledger total." },
    { label: "Services", value: distinctServices, helperText: "Distinct services in the loaded appointment rows." },
    { label: "Open / upcoming", value: counts.open, helperText },
    { label: "Checked out", value: counts.checkedOut, helperText },
    { label: "Cancelled", value: counts.cancelled, helperText },
    { label: "No-show", value: counts.noShow, helperText },
  ].map((tool) => ({ ...tool, capability: "read_only" }));
}

function isOpenTreatmentCandidate(row: ApicoreBookingDetailsRow) {
  return OPEN_TREATMENT_STATUSES.has(normalizeStatus(row.status));
}

function isCheckedInLedgerCandidate(row: ApicoreBookingDetailsRow) {
  return CHECKED_IN_LEDGER_STATUSES.has(normalizeStatus(row.status));
}

function treatmentStartProxyWarning(): NonNullable<AgentToolResult["warnings"]>[number] {
  return {
    type: "treatment_start_proxy",
    title: "Treatment start is inferred",
    message:
      "APICORE does not expose a treatment_started_at event here, so this uses booking status as a proxy and does not confirm exact treatment-start time.",
  };
}

async function snapshot(input: AgentToolInput, options?: { includeCheckIns?: boolean }) {
  return fetchLiveAppointmentSnapshot({
    clinicId: input.clinic.clinicId,
    clinicCode: input.clinic.clinicCode,
    dateKey: input.period.toDate,
    timezone: input.request.timezone ?? "",
    authorizationHeader: input.requestContext.authorizationHeader,
    rowLimit: 200,
    includeCheckIns: options?.includeCheckIns,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function numberFrom(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function countFromRecord(record: Record<string, unknown>, keys: string[]) {
  return keys.reduce((total, key) => total + (numberFrom(record[key]) ?? 0), 0);
}

async function getOperationalAppointmentSnapshot(input: AgentToolInput, options?: { allowStale?: boolean }) {
  if (!env.AGENT_SNAPSHOT_CACHE_ENABLED) {
    return null;
  }

  const snapshot = await getFreshFactSnapshot({
    clinicId: input.clinic.clinicId,
    snapshotType: "appointment_operational_snapshot",
    expectedFromDate: input.period.toDate,
    expectedToDate: input.period.toDate,
    maxAgeMs: env.AGENT_OPERATIONAL_SNAPSHOT_MAX_AGE_MINUTES * 60_000,
    allowStale: options?.allowStale,
  }).catch(() => null);

  if (!snapshot) {
    return null;
  }

  const snapshotDate = snapshot.dateRange?.toDate ?? snapshot.dateRange?.fromDate;
  if (snapshotDate !== input.period.toDate) {
    return null;
  }

  return snapshot;
}

async function getCompletedDayAppointmentProfileSnapshot(input: AgentToolInput) {
  if (!env.AGENT_SNAPSHOT_CACHE_ENABLED || !env.AGENT_COMPLETED_DAY_SNAPSHOT_ENABLED) {
    return null;
  }

  if (
    !isCompletedHistoricalDay({
      fromDate: input.period.fromDate,
      toDate: input.period.toDate,
      timezone: input.request.timezone,
    })
  ) {
    return null;
  }

  return getFactSnapshotForPeriod({
    clinicId: input.clinic.clinicId,
    snapshotType: "appointment_daily_profile",
    fromDate: input.period.fromDate,
    toDate: input.period.toDate,
    maxAgeMs: env.AGENT_SNAPSHOT_MAX_AGE_MINUTES * 60_000,
  }).catch(() => null);
}

export function buildAppointmentCountResultFromSnapshot(params: {
  input: AgentToolInput;
  snapshot: GtAgentFactSnapshot;
  snapshotKind: "operational" | "daily_profile";
  liveUnavailableMessage?: string;
  staleFallback?: boolean;
}): AgentToolResult {
  const summary = params.snapshot.summary;
  const lifecycleCounts = isRecord(summary.lifecycleCounts) ? summary.lifecycleCounts : {};
  const totalAppointments =
    numberFrom(summary.bookingAppointmentCount) ??
    numberFrom(summary.bookingRowCount) ??
    numberFrom(summary.rowCount) ??
    0;
  const booked = countFromRecord(lifecycleCounts, ["booked", "requested"]);
  const checkedIn = countFromRecord(lifecycleCounts, ["arrived_start_unknown", "treatment_in_progress"]);
  const checkedOut = countFromRecord(lifecycleCounts, ["checked_out"]);
  const cancelled = countFromRecord(lifecycleCounts, ["cancelled"]);
  const noShow = countFromRecord(lifecycleCounts, ["no_show"]);
  const warnings: NonNullable<AgentToolResult["warnings"]> = [];

  if (params.liveUnavailableMessage) {
    warnings.push({
      type: "live_appointment_source_unavailable",
      title: "Live source unavailable",
      message: params.liveUnavailableMessage,
    });
  }

  if (params.staleFallback) {
    warnings.push(buildSnapshotStaleWarning({
      snapshotType: params.snapshot.snapshotType,
      checkedAt: params.snapshot.checkedAt,
    }));
  }
  const sourceName =
    params.snapshotKind === "daily_profile"
      ? "GreatTime learned appointment daily profile"
      : "GreatTime learned appointment operational snapshot";
  const source = factSnapshotToAgentSource({
    snapshot: params.snapshot,
    toolName: "get_live_appointment_counts",
    sourceName,
    scope: params.snapshotKind === "daily_profile" ? "historical" : "learned",
    live: false,
  });
  const totalLabel = params.snapshotKind === "daily_profile" ? "Total appointments" : "Total appointments today";
  const summaryPrefix = params.snapshotKind === "daily_profile" ? "Saved appointment daily profile" : "Latest saved appointment snapshot";

  return {
    toolName: "get_live_appointment_counts",
    sourceName,
    checkedAt: params.snapshot.checkedAt,
    period: periodLabel(params.input),
    dataStatus: params.staleFallback ? "stale" : totalAppointments > 0 ? params.snapshot.dataStatus : "no_activity",
    live: false,
    freshnessSeconds: source.freshnessSeconds,
    summary: `${summaryPrefix} has ${totalAppointments.toLocaleString("en-US")} scheduled appointment${totalAppointments === 1 ? "" : "s"} for ${periodLabel(params.input)}.`,
    metrics: [
      { label: totalLabel, value: totalAppointments, helperText: "From a source-backed APICORE appointment snapshot." },
      { label: "Booked", value: booked },
      { label: "Checked in at snapshot time", value: checkedIn },
      { label: "Checked out", value: checkedOut },
      { label: "Cancelled", value: cancelled },
      { label: "No-show", value: noShow },
    ],
    warnings: warnings.length ? warnings : undefined,
    sources: [source],
  };
}

const defaultAppointmentToolDeps: AppointmentToolDeps = {
  getCompletedDayAppointmentProfileSnapshot,
  getOperationalAppointmentSnapshot,
  fetchLiveSnapshot: snapshot,
};

async function buildCachedAppointmentCountResultWithDeps(
  input: AgentToolInput,
  liveUnavailableMessage: string,
  deps: AppointmentToolDeps,
): Promise<AgentToolResult | null> {
  const snapshot = await deps.getOperationalAppointmentSnapshot(input, { allowStale: true });
  if (!snapshot) {
    return null;
  }

  return buildAppointmentCountResultFromSnapshot({
    input,
    snapshot,
    snapshotKind: "operational",
    liveUnavailableMessage,
    staleFallback: true,
  });
}

async function getAppointmentLedger(input: AgentToolInput): Promise<AgentToolResult> {
  const data = await fetchAppointmentLedger(input);
  const label = periodLabel(input);

  return {
    toolName: "get_appointment_ledger",
    sourceName: "APICORE appointment ledger",
    checkedAt: data.checkedAt,
    period: label,
    dataStatus: data.dataStatus,
    live: true,
    summary: `Appointment ledger has ${data.totalCount.toLocaleString("en-US")} appointment${data.totalCount === 1 ? "" : "s"} for ${label}.`,
    metrics: ledgerStatusMetrics(data.rows, data.totalCount),
    tables: [appointmentServiceTable(data.rows), ledgerTable("Appointments", data.rows)],
    warnings: data.warnings,
    entityRefs: data.rows.map((row, index) => appointmentLedgerEntityRef(row, index + 1)),
  };
}

async function getTreatmentStartProxy(input: AgentToolInput): Promise<AgentToolResult> {
  const data = await fetchAppointmentLedger(input);
  const label = periodLabel(input);
  const rows =
    input.intent === "treatment_in_progress"
      ? data.rows.filter(isCheckedInLedgerCandidate)
      : data.rows.filter(isOpenTreatmentCandidate);
  const checkedInRows = rows.filter(isCheckedInLedgerCandidate);
  const statusLabel =
    input.intent === "treatment_in_progress"
      ? "checked-in appointments"
      : "appointments that are not completed, cancelled, or no-show";
  const dataStatus: AgentDataStatus = rows.length ? data.dataStatus : "no_activity";

  return {
    toolName: "get_treatment_start_proxy",
    sourceName: "APICORE appointment ledger",
    checkedAt: data.checkedAt,
    period: label,
    dataStatus,
    live: true,
    summary: `APICORE does not confirm exact treatment-start time. Using booking status as a proxy, ${rows.length.toLocaleString("en-US")} ${statusLabel} were found for ${label}.`,
    metrics: [
      {
        label: input.intent === "treatment_in_progress" ? "Checked-in proxy" : "Not-started proxy",
        value: rows.length,
        helperText:
          input.intent === "treatment_in_progress"
            ? "Rows with CHECKIN status; exact in-treatment state is not available."
            : "Rows with REQUEST, BOOKED, or CHECKIN status.",
      },
      { label: "Checked in", value: checkedInRows.length, helperText: "Rows with CHECKIN status." },
      {
        label: "Booked / requested",
        value: rows.length - checkedInRows.length,
        helperText: "Rows not yet completed, cancelled, or no-show.",
      },
    ],
    tables: [ledgerTable(input.intent === "treatment_in_progress" ? "Checked-in proxy rows" : "Treatment not-started proxy rows", rows)],
    warnings: [...data.warnings, treatmentStartProxyWarning()],
    entityRefs: rows.map((row, index) => appointmentLedgerEntityRef(row, index + 1)),
  };
}

async function getLiveAppointmentCounts(
  input: AgentToolInput,
  deps: AppointmentToolDeps = defaultAppointmentToolDeps,
): Promise<AgentToolResult> {
  const dailyProfileSnapshot = await deps.getCompletedDayAppointmentProfileSnapshot(input);
  if (dailyProfileSnapshot) {
    return buildAppointmentCountResultFromSnapshot({
      input,
      snapshot: dailyProfileSnapshot,
      snapshotKind: "daily_profile",
    });
  }

  const cachedSnapshot = await deps.getOperationalAppointmentSnapshot(input);
  if (cachedSnapshot) {
    return buildAppointmentCountResultFromSnapshot({
      input,
      snapshot: cachedSnapshot,
      snapshotKind: "operational",
    });
  }

  let data: Awaited<ReturnType<typeof snapshot>>;
  const includeCheckIns = input.intent !== "appointment_summary";

  try {
    data = await deps.fetchLiveSnapshot(input, { includeCheckIns });
  } catch (error) {
    const fallback = await buildCachedAppointmentCountResultWithDeps(input, sanitizeError(error), deps);
    if (fallback) {
      return fallback;
    }
    throw error;
  }

  const bookingSourceUnavailable = data.warnings.some((warning) => warning.type === "booking_source_unavailable");
  if (bookingSourceUnavailable) {
    const fallback = await buildCachedAppointmentCountResultWithDeps(input, "Live appointment bookings could not be loaded.", deps);
    if (fallback) {
      return fallback;
    }
  }

  const bookingRows = data.rows.filter(isScheduledLiveRow);
  const countableRows = bookingRows.filter(isCountableTodayAppointment);
  const activeCheckedInRows = data.rows.filter(isActiveCheckedInAppointment);
  const countableLifecycle = {
    booked: countableRows.filter((row) => row.lifecycleState === "booked").length,
    activeCheckedIn: activeCheckedInRows.length,
    checkedOut: includeCheckIns
      ? data.rows.filter((row) => row.lifecycleState === "checked_out").length
      : countableRows.filter((row) => row.lifecycleState === "checked_out").length,
    cancelled: countableRows.filter((row) => row.lifecycleState === "cancelled").length,
    noShow: countableRows.filter((row) => row.lifecycleState === "no_show").length,
  };
  const metrics = [
    { label: "Total appointments today", value: countableRows.length, helperText: "Excludes MERCHANT_CANCEL rows." },
    { label: "Booked", value: countableLifecycle.booked },
    ...(includeCheckIns
      ? [{ label: "Checked in now", value: countableLifecycle.activeCheckedIn, helperText: "Has check-in time and no check-out time." }]
      : []),
    { label: "Checked out", value: countableLifecycle.checkedOut },
    { label: "Cancelled", value: countableLifecycle.cancelled },
    { label: "No-show", value: countableLifecycle.noShow },
  ];

  return {
    toolName: "get_live_appointment_counts",
    sourceName: includeCheckIns ? "APICORE live bookings and check-ins" : "APICORE live bookings",
    checkedAt: data.checkedAt,
    period: input.period.toDate,
    dataStatus: data.dataStatus,
    live: true,
    summary: `Today's appointment snapshot has ${countableRows.length.toLocaleString("en-US")} scheduled appointment${countableRows.length === 1 ? "" : "s"} for ${input.period.toDate}, excluding merchant-cancelled rows.`,
    metrics,
    tables: [liveTable("Today's appointment rows", countableRows)],
    warnings: data.warnings,
    entityRefs: countableRows.map((row, index) => liveAppointmentEntityRef(row, index + 1, input.clinic.clinicCode)),
  };
}

async function listLiveAppointments(input: AgentToolInput, deps: AppointmentToolDeps = defaultAppointmentToolDeps): Promise<AgentToolResult> {
  const data = await deps.fetchLiveSnapshot(input);

  return {
    toolName: "list_live_appointments",
    sourceName: "APICORE live bookings and check-ins",
    checkedAt: data.checkedAt,
    period: input.period.toDate,
    dataStatus: data.dataStatus,
    live: true,
    tables: [liveTable("Live appointment rows", data.rows)],
    warnings: data.warnings,
    entityRefs: data.rows.map((row, index) => liveAppointmentEntityRef(row, index + 1, input.clinic.clinicCode)),
  };
}

async function getCheckedInCustomers(input: AgentToolInput, deps: AppointmentToolDeps = defaultAppointmentToolDeps): Promise<AgentToolResult> {
  const data = await deps.fetchLiveSnapshot(input);
  const rows = data.rows.filter(isActiveCheckedInAppointment);

  return {
    toolName: "get_checked_in_customers",
    sourceName: "APICORE live check-ins",
    checkedAt: data.checkedAt,
    period: input.period.toDate,
    dataStatus: rows.length ? data.dataStatus : "no_activity",
    live: true,
    summary: `${rows.length.toLocaleString("en-US")} appointment${rows.length === 1 ? "" : "s"} are checked in right now and have not checked out.`,
    metrics: [{ label: "Checked in now", value: rows.length, helperText: "Has check-in time and no check-out time." }],
    tables: [liveTable("Checked-in appointments not checked out", rows)],
    warnings: [
      ...data.warnings,
      {
        type: "active_check_in_definition",
        title: "Checked-in definition",
        message: "This count uses rows with check-in time and no check-out time.",
      },
    ],
    entityRefs: rows.map((row, index) => liveAppointmentEntityRef(row, index + 1, input.clinic.clinicCode)),
  };
}

async function getCheckedOutCustomers(input: AgentToolInput, deps: AppointmentToolDeps = defaultAppointmentToolDeps): Promise<AgentToolResult> {
  const data = await deps.fetchLiveSnapshot(input);
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
    entityRefs: rows.map((row, index) => liveAppointmentEntityRef(row, index + 1, input.clinic.clinicCode)),
  };
}

async function getNotCheckedOutCustomers(input: AgentToolInput, deps: AppointmentToolDeps = defaultAppointmentToolDeps): Promise<AgentToolResult> {
  const data = await deps.fetchLiveSnapshot(input);
  const rows = data.rows.filter(isNotCheckedOutAppointment);

  return {
    toolName: "get_not_checked_out_customers",
    sourceName: "APICORE live bookings and check-ins",
    checkedAt: data.checkedAt,
    period: input.period.toDate,
    dataStatus: rows.length ? data.dataStatus : "no_activity",
    live: true,
    summary: `${rows.length.toLocaleString("en-US")} appointments have not checked out yet for ${input.period.toDate}.`,
    metrics: [{ label: "Not checked out yet", value: rows.length }],
    tables: [liveTable("Appointments not checked out", rows)],
    warnings: data.warnings,
    entityRefs: rows.map((row, index) => liveAppointmentEntityRef(row, index + 1, input.clinic.clinicCode)),
  };
}

async function getArrivedNotStartedCustomers(input: AgentToolInput, deps: AppointmentToolDeps = defaultAppointmentToolDeps): Promise<AgentToolResult> {
  const data = await deps.fetchLiveSnapshot(input);
  const hasTreatmentStartField = data.rows.some((row) => row.treatmentStartKnown);
  const rows = hasTreatmentStartField
    ? data.rows.filter(
        (row) =>
          Boolean(row.checkInTime) &&
          !row.treatmentStartedAt &&
          !row.checkOutTime &&
          !isCancelledNoShowOrCancelledStatus(row) &&
          row.lifecycleState !== "checked_out",
      )
    : data.rows.filter(isActiveCheckedInAppointment);
  const warning = hasTreatmentStartField
    ? null
    : {
        type: "treatment_start_unavailable",
        title: "Treatment/process start time unavailable",
        message:
          "Treatment/process start time is not exposed by APICORE in this query, so this list shows checked-in customers who have not checked out.",
      };

  return {
    toolName: "get_arrived_not_started_customers",
    sourceName: "APICORE live bookings and check-ins",
    checkedAt: data.checkedAt,
    period: input.period.toDate,
    dataStatus: rows.length ? data.dataStatus : "no_activity",
    live: true,
    summary: hasTreatmentStartField
      ? `${rows.length.toLocaleString("en-US")} checked-in customers have not started treatment for ${input.period.toDate}.`
      : `${rows.length.toLocaleString("en-US")} checked-in customers have not checked out for ${input.period.toDate}; treatment/process start time is not exposed by APICORE in this query.`,
    metrics: [
      {
        label: hasTreatmentStartField ? "Arrived but not started treatment" : "Arrived not checked out proxy",
        value: rows.length,
      },
    ],
    tables: [liveTable(hasTreatmentStartField ? "Arrived but not started treatment" : "Arrived, treatment start unknown", rows)],
    warnings: warning ? [...data.warnings, warning] : data.warnings,
    entityRefs: rows.map((row, index) => liveAppointmentEntityRef(row, index + 1, input.clinic.clinicCode)),
  };
}

async function getCancelledNoShowCustomers(input: AgentToolInput, deps: AppointmentToolDeps = defaultAppointmentToolDeps): Promise<AgentToolResult> {
  const data = await deps.fetchLiveSnapshot(input);
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
    entityRefs: rows.map((row, index) => liveAppointmentEntityRef(row, index + 1, input.clinic.clinicCode)),
  };
}

async function getAppointmentDetail(input: AgentToolInput, deps: AppointmentToolDeps = defaultAppointmentToolDeps): Promise<AgentToolResult> {
  const data = await deps.fetchLiveSnapshot(input);
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
    entityRefs: rows.map((row, index) => liveAppointmentEntityRef(row, index + 1, input.clinic.clinicCode)),
  };
}

async function getAppointmentTrends(input: AgentToolInput): Promise<AgentToolResult> {
  const data = await runAppointmentBigQueryOperation({
    toolName: "get_appointment_trends",
    operationName: "report",
    callback: () =>
      getServiceBehaviorReport({
        clinicCode: input.clinic.clinicCode,
        fromDate: input.period.fromDate,
        toDate: input.period.toDate,
        granularity: "month",
      }),
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

export function createAppointmentTools(overrides: Partial<AppointmentToolDeps> = {}): AgentToolDefinition[] {
  const deps = { ...defaultAppointmentToolDeps, ...overrides };

  const tools: AgentToolDefinition[] = [
    {
      name: "get_appointment_ledger",
      agentId: "appointment",
      description: "Get appointment ledger rows and counts from APICORE booking details.",
      inputSchema: toolInputSchema,
      sourceName: "APICORE appointment ledger",
      live: true,
      maxRows: LEDGER_TABLE_ROWS,
      timeoutMs: 20_000,
      execute: getAppointmentLedger,
    },
    {
      name: "get_treatment_start_proxy",
      agentId: "appointment",
      description: "List appointments where treatment start is inferred from APICORE booking status.",
      inputSchema: toolInputSchema,
      sourceName: "APICORE appointment ledger",
      live: true,
      maxRows: LEDGER_TABLE_ROWS,
      timeoutMs: 20_000,
      execute: getTreatmentStartProxy,
    },
    {
      name: "get_live_appointment_counts",
      agentId: "appointment",
      description: "Get live appointment lifecycle counts.",
      inputSchema: toolInputSchema,
      sourceName: "APICORE live appointment data",
      live: true,
      maxRows: 50,
      timeoutMs: 20_000,
      execute: (input) => getLiveAppointmentCounts(input, deps),
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
      execute: (input) => listLiveAppointments(input, deps),
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
      execute: (input) => getCheckedInCustomers(input, deps),
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
      execute: (input) => getCheckedOutCustomers(input, deps),
    },
    {
      name: "get_not_checked_out_customers",
      agentId: "appointment",
      description: "List appointments that have not checked out yet.",
      inputSchema: toolInputSchema,
      sourceName: "APICORE live bookings and check-ins",
      live: true,
      maxRows: 50,
      timeoutMs: 20_000,
      execute: (input) => getNotCheckedOutCustomers(input, deps),
    },
    {
      name: "get_arrived_not_started_customers",
      agentId: "appointment",
      description: "List arrived customers whose treatment start is not confirmed yet.",
      inputSchema: toolInputSchema,
      sourceName: "APICORE live bookings and check-ins",
      live: true,
      maxRows: 50,
      timeoutMs: 20_000,
      execute: (input) => getArrivedNotStartedCustomers(input, deps),
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
      execute: (input) => getCancelledNoShowCustomers(input, deps),
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
      execute: (input) => getAppointmentDetail(input, deps),
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

  return tools.map((tool) => ({ ...tool, capability: "read_only" }));
}
