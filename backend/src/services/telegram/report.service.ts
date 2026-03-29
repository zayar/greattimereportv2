import { fetchApicoreBookingDetails, type ApicoreBookingDetailsRow } from "../apicore.service.js";
import { sendTelegramMessage } from "./bot.service.js";
import {
  buildUtcDayRangeForDateKey,
  formatDateKeyInTimeZone,
  formatDisplayTimeInTimeZone,
  normalizeTimeZone,
} from "./time.js";
import type { TodayAppointmentReportItem, TodayAppointmentReportSummary } from "./types.js";

const PAGE_SIZE = 200;
const APPOINTMENT_PREVIEW_LIMIT = 12;
const THERAPIST_PREVIEW_LIMIT = 5;
const SERVICE_PREVIEW_LIMIT = 5;

const CANCELLED_STATUSES = new Set(["MERCHANT_CANCEL", "MEMBER_CANCEL", "CANCEL"]);
const COMPLETED_STATUSES = new Set(["CHECKOUT", "CHECKED_OUT"]);
const NO_SHOW_STATUSES = new Set(["NO_SHOW"]);
const UPCOMING_STATUSES = new Set(["BOOKED", "CHECKIN", "REQUEST"]);

function normalizeStatus(status: string | null | undefined) {
  return (status ?? "").trim().toUpperCase();
}

function mapStatusLabel(status: string) {
  const normalized = normalizeStatus(status);
  if (COMPLETED_STATUSES.has(normalized)) {
    return "completed";
  }

  if (CANCELLED_STATUSES.has(normalized)) {
    return "cancelled";
  }

  if (NO_SHOW_STATUSES.has(normalized)) {
    return "no-show";
  }

  if (normalized === "CHECKIN") {
    return "check-in";
  }

  return "upcoming";
}

function summarizeCounts(rows: ApicoreBookingDetailsRow[]) {
  return rows.reduce(
    (summary, row) => {
      const normalized = normalizeStatus(row.status);
      if (COMPLETED_STATUSES.has(normalized)) {
        summary.completedCount += 1;
      } else if (CANCELLED_STATUSES.has(normalized)) {
        summary.cancelledCount += 1;
      } else if (NO_SHOW_STATUSES.has(normalized)) {
        summary.noShowCount += 1;
      } else if (UPCOMING_STATUSES.has(normalized) || !normalized) {
        summary.upcomingCount += 1;
      } else {
        summary.upcomingCount += 1;
      }

      return summary;
    },
    {
      upcomingCount: 0,
      completedCount: 0,
      cancelledCount: 0,
      noShowCount: 0,
    },
  );
}

function summarizeByKey(
  rows: ApicoreBookingDetailsRow[],
  getter: (row: ApicoreBookingDetailsRow) => string,
) {
  const counts = new Map<string, number>();

  rows.forEach((row) => {
    const key = getter(row).trim() || "Unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

async function fetchAllAppointmentsForToday(input: {
  clinicCode: string;
  timezone: string;
  authorizationHeader?: string;
  referenceDate?: Date;
}) {
  const dateKey = formatDateKeyInTimeZone(input.referenceDate ?? new Date(), input.timezone);
  const { startIso, endIso } = buildUtcDayRangeForDateKey(dateKey);

  const rows: ApicoreBookingDetailsRow[] = [];
  let skip = 0;
  let totalCount = Number.POSITIVE_INFINITY;

  while (rows.length < totalCount) {
    const result = await fetchApicoreBookingDetails({
      clinicCode: input.clinicCode,
      startDate: startIso,
      endDate: endIso,
      skip,
      take: PAGE_SIZE,
      authorizationHeader: input.authorizationHeader,
    });

    rows.push(...result.data);
    totalCount = result.totalCount;
    if (result.data.length === 0) {
      break;
    }
    skip += result.data.length;
  }

  return {
    dateKey,
    rows: rows.sort((left, right) => new Date(left.FromTime).getTime() - new Date(right.FromTime).getTime()),
  };
}

export async function getTodayAppointmentsForClinic(input: {
  clinicCode: string;
  timezone?: string;
  authorizationHeader?: string;
  referenceDate?: Date;
}) {
  const timezone = normalizeTimeZone(input.timezone);
  return fetchAllAppointmentsForToday({
    clinicCode: input.clinicCode,
    timezone,
    authorizationHeader: input.authorizationHeader,
    referenceDate: input.referenceDate,
  });
}

export function summarizeAppointmentCounts(rows: ApicoreBookingDetailsRow[]) {
  return summarizeCounts(rows);
}

export function summarizeTopServices(rows: ApicoreBookingDetailsRow[]) {
  return summarizeByKey(rows, (row) => row.ServiceName)
    .slice(0, SERVICE_PREVIEW_LIMIT)
    .map(({ label, count }) => ({
      serviceName: label,
      count,
    }));
}

export function summarizeTherapistLoad(rows: ApicoreBookingDetailsRow[]) {
  return summarizeByKey(rows, (row) => row.PractitionerName)
    .slice(0, THERAPIST_PREVIEW_LIMIT)
    .map(({ label, count }) => ({
      therapistName: label,
      count,
    }));
}

function mapAppointments(rows: ApicoreBookingDetailsRow[], timezone: string): TodayAppointmentReportItem[] {
  return rows.slice(0, APPOINTMENT_PREVIEW_LIMIT).map((row) => ({
    time: formatDisplayTimeInTimeZone(new Date(row.FromTime), timezone),
    customerName: row.MemberName?.trim() || "Unknown customer",
    serviceName: row.ServiceName?.trim() || "Unknown service",
    therapistName: row.PractitionerName?.trim() || "Unassigned",
    status: mapStatusLabel(row.status),
  }));
}

export async function buildTodayAppointmentReport(input: {
  clinicCode: string;
  clinicName?: string;
  timezone?: string;
  authorizationHeader?: string;
  referenceDate?: Date;
}) {
  const timezone = normalizeTimeZone(input.timezone);
  const { dateKey, rows } = await getTodayAppointmentsForClinic({
    clinicCode: input.clinicCode,
    timezone,
    authorizationHeader: input.authorizationHeader,
    referenceDate: input.referenceDate,
  });
  const counts = summarizeAppointmentCounts(rows);
  const appointments = mapAppointments(rows, timezone);
  const clinicName = input.clinicName || rows[0]?.ClinicName || input.clinicCode;

  return {
    clinicName,
    dateKey,
    timezone,
    totalAppointments: rows.length,
    upcomingCount: counts.upcomingCount,
    completedCount: counts.completedCount,
    cancelledCount: counts.cancelledCount,
    noShowCount: counts.noShowCount,
    appointments,
    topServices: summarizeTopServices(rows),
    therapistLoad: summarizeTherapistLoad(rows),
  } satisfies TodayAppointmentReportSummary;
}

export function formatTodayAppointmentTelegramMessage(report: TodayAppointmentReportSummary) {
  const lines: string[] = [
    "📅 ယနေ့ Appointment Report",
    `Clinic: ${report.clinicName}`,
    `Date: ${report.dateKey}`,
    `Timezone: ${report.timezone}`,
    "",
    `စုစုပေါင်း appointment: ${report.totalAppointments}`,
    `လာမည့် appointment: ${report.upcomingCount}`,
    `ပြီးဆုံး: ${report.completedCount}`,
    `ပယ်ဖျက်: ${report.cancelledCount}`,
    `မလာ: ${report.noShowCount}`,
    "",
    "🕒 အချိန်စာရင်း",
  ];

  if (report.appointments.length === 0) {
    lines.push("ယနေ့ appointment မရှိပါ။");
  } else {
    report.appointments.forEach((appointment) => {
      lines.push(
        `${appointment.time} - ${appointment.customerName} - ${appointment.serviceName} - ${appointment.therapistName} - ${appointment.status}`,
      );
    });
  }

  const remainingAppointments = report.totalAppointments - report.appointments.length;
  if (remainingAppointments > 0) {
    lines.push(`+${remainingAppointments} more appointments`);
  }

  if (report.therapistLoad.length > 0) {
    lines.push("", "👩‍⚕️ Therapist load");
    report.therapistLoad.forEach((entry) => {
      lines.push(`${entry.therapistName} - ${entry.count}`);
    });
  }

  if (report.topServices.length > 0) {
    lines.push("", "🔥 Top services");
    report.topServices.forEach((entry) => {
      lines.push(`${entry.serviceName} - ${entry.count}`);
    });
  }

  return lines.join("\n");
}

export async function sendTodayAppointmentReport(input: {
  chatId: string;
  clinicCode: string;
  clinicName?: string;
  timezone?: string;
  authorizationHeader?: string;
  referenceDate?: Date;
}) {
  const report = await buildTodayAppointmentReport(input);
  const message = formatTodayAppointmentTelegramMessage(report);
  await sendTelegramMessage(input.chatId, message);

  return {
    sentAt: new Date().toISOString(),
    report,
    message,
  };
}
