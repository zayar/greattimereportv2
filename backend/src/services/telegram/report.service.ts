import { fetchApicoreBookingDetails, type ApicoreBookingDetailsRow } from "../apicore.service.js";
import {
  buildApicoreBookingDetailsDateRange,
  isApicoreBookingWallClockDateInRange,
} from "../apicore-booking-details-range.js";
import {
  buildAppointmentReportAiPayload,
  percentageRate,
} from "../reports/report-ai-insights.service.js";
import { hasFeatureAccess } from "../feature-access.service.js";
import { GT_GROWTH_AI_FEATURE_GATE } from "../../types/report-ai.js";
import { sendTelegramMessage } from "./bot.service.js";
import { formatGtGrowthAiTelegramSection } from "./gt-growth-ai-message.js";
import {
  formatDateKeyInTimeZone,
  formatDisplayTimeInTimeZone,
  normalizeTimeZone,
} from "./time.js";
import type { TodayAppointmentReportItem, TodayAppointmentReportSummary } from "./types.js";

const PAGE_SIZE = 200;
const APPOINTMENT_PREVIEW_LIMIT = 12;
const THERAPIST_PREVIEW_LIMIT = 5;
const SERVICE_PREVIEW_LIMIT = 5;
const BUSY_HOUR_PREVIEW_LIMIT = 5;
const UNDERUTILIZED_HOUR_PREVIEW_LIMIT = 5;
const REBOOKING_LOOKAHEAD_DAYS = 60;
const SAME_WEEKDAY_BENCHMARK_WEEKS = 4;

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

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map((value) => Number(value));
  return new Date(Date.UTC(year, month - 1, day));
}

function addDaysToDateKey(dateKey: string, days: number) {
  const date = parseDateKey(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function fetchAllAppointmentsForRange(input: {
  clinicCode: string;
  fromDate: string;
  toDate: string;
  authorizationHeader?: string;
}) {
  const rows: ApicoreBookingDetailsRow[] = [];
  const range = buildApicoreBookingDetailsDateRange({
    fromDate: input.fromDate,
    toDate: input.toDate,
  });
  let skip = 0;
  let totalCount = Number.POSITIVE_INFINITY;

  while (rows.length < totalCount) {
    const result = await fetchApicoreBookingDetails({
      clinicCode: input.clinicCode,
      startDate: range.startIso,
      endDate: range.endIso,
      skip,
      take: PAGE_SIZE,
      authorizationHeader: input.authorizationHeader,
    });

    rows.push(
      ...result.data.filter((row) =>
        isApicoreBookingWallClockDateInRange(row.FromTime, input.fromDate, input.toDate),
      ),
    );
    totalCount = result.totalCount;
    if (result.data.length === 0) {
      break;
    }
    skip += result.data.length;
  }

  return rows.sort((left, right) => new Date(left.FromTime).getTime() - new Date(right.FromTime).getTime());
}

async function fetchAllAppointmentsForToday(input: {
  clinicCode: string;
  timezone: string;
  authorizationHeader?: string;
  referenceDate?: Date;
  dateKey?: string;
}) {
  const dateKey = input.dateKey ?? formatDateKeyInTimeZone(input.referenceDate ?? new Date(), input.timezone);

  return {
    dateKey,
    rows: await fetchAllAppointmentsForRange({
      clinicCode: input.clinicCode,
      fromDate: dateKey,
      toDate: dateKey,
      authorizationHeader: input.authorizationHeader,
    }),
  };
}

export async function getTodayAppointmentsForClinic(input: {
  clinicCode: string;
  timezone?: string;
  authorizationHeader?: string;
  referenceDate?: Date;
  dateKey?: string;
}) {
  const timezone = normalizeTimeZone(input.timezone);
  return fetchAllAppointmentsForToday({
    clinicCode: input.clinicCode,
    timezone,
    authorizationHeader: input.authorizationHeader,
    referenceDate: input.referenceDate,
    dateKey: input.dateKey,
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

function getLocalHour(date: Date, timezone: string) {
  const hour = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(date);

  return Number(hour);
}

function formatHourSlot(hour: number) {
  const start = String(hour).padStart(2, "0");
  const end = String((hour + 1) % 24).padStart(2, "0");
  return `${start}:00-${end}:00`;
}

export function summarizeAppointmentHourLoad(rows: ApicoreBookingDetailsRow[], timezone: string) {
  const counts = new Map<number, number>();

  rows.forEach((row) => {
    const normalized = normalizeStatus(row.status);
    if (CANCELLED_STATUSES.has(normalized)) {
      return;
    }

    const date = new Date(row.FromTime);
    if (Number.isNaN(date.getTime())) {
      return;
    }

    const hour = getLocalHour(date, timezone);
    if (!Number.isFinite(hour)) {
      return;
    }

    counts.set(hour, (counts.get(hour) ?? 0) + 1);
  });

  const slots = [...counts.entries()].map(([hour, count]) => ({
    label: formatHourSlot(hour),
    count,
    hour,
  }));

  const busyHours = slots
    .map(({ label, count }) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, BUSY_HOUR_PREVIEW_LIMIT);

  if (slots.length < 2) {
    return {
      busyHours,
      underutilizedHours: [],
    };
  }

  const hours = slots.map((slot) => slot.hour);
  const minHour = Math.min(...hours);
  const maxHour = Math.max(...hours);
  const peak = Math.max(...slots.map((slot) => slot.count));
  const threshold = Math.max(1, Math.floor(peak * 0.5));
  const allObservedRangeSlots = Array.from({ length: maxHour - minHour + 1 }, (_, index) => {
    const hour = minHour + index;
    return {
      label: formatHourSlot(hour),
      count: counts.get(hour) ?? 0,
    };
  });

  return {
    busyHours,
    underutilizedHours: allObservedRangeSlots
      .filter((slot) => slot.count < threshold)
      .sort((left, right) => left.count - right.count || left.label.localeCompare(right.label))
      .slice(0, UNDERUTILIZED_HOUR_PREVIEW_LIMIT),
  };
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

function buildCustomerKey(row: ApicoreBookingDetailsRow) {
  const phone = row.MemberPhoneNumber?.replace(/\D/g, "") ?? "";
  if (phone) {
    return `phone:${phone}`;
  }

  const name = row.MemberName?.trim().toLowerCase() ?? "";
  return name ? `name:${name}` : "";
}

async function countCompletedCustomersWithoutFutureBooking(input: {
  clinicCode: string;
  timezone: string;
  dateKey: string;
  rows: ApicoreBookingDetailsRow[];
  authorizationHeader?: string;
}) {
  const completedCustomerKeys = new Set(
    input.rows
      .filter((row) => COMPLETED_STATUSES.has(normalizeStatus(row.status)))
      .map(buildCustomerKey)
      .filter(Boolean),
  );

  if (completedCustomerKeys.size === 0) {
    return 0;
  }

  try {
    const startDateKey = addDaysToDateKey(input.dateKey, 1);
    const endDateKey = addDaysToDateKey(input.dateKey, REBOOKING_LOOKAHEAD_DAYS);
    const futureRows = await fetchAllAppointmentsForRange({
      clinicCode: input.clinicCode,
      fromDate: startDateKey,
      toDate: endDateKey,
      authorizationHeader: input.authorizationHeader,
    });
    const futureCustomerKeys = new Set(futureRows.map(buildCustomerKey).filter(Boolean));

    return [...completedCustomerKeys].filter((customerKey) => !futureCustomerKeys.has(customerKey)).length;
  } catch (error) {
    console.warn("[GT_V2Report][GT Growth AI] future booking lookup failed", {
      clinicCode: input.clinicCode,
      dateKey: input.dateKey,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return null;
  }
}

async function fetchSameWeekdayBenchmark(input: {
  clinicCode: string;
  timezone: string;
  dateKey: string;
  authorizationHeader?: string;
}) {
  try {
    const dateKeys = Array.from({ length: SAME_WEEKDAY_BENCHMARK_WEEKS }, (_, index) =>
      addDaysToDateKey(input.dateKey, -7 * (index + 1)),
    );
    const rowsByDay = await Promise.all(
      dateKeys.map((dateKey) => {
        return fetchAllAppointmentsForRange({
          clinicCode: input.clinicCode,
          fromDate: dateKey,
          toDate: dateKey,
          authorizationHeader: input.authorizationHeader,
        });
      }),
    );
    const validDays = rowsByDay.filter((rows) => rows.length > 0);

    if (validDays.length === 0) {
      return null;
    }

    const appointmentCounts = validDays.map((rows) => rows.length);
    const noShowRates = validDays
      .map((rows) => {
        const counts = summarizeAppointmentCounts(rows);
        return percentageRate(counts.noShowCount, rows.length);
      })
      .filter((rate): rate is number => rate != null);
    const cancellationRates = validDays
      .map((rows) => {
        const counts = summarizeAppointmentCounts(rows);
        return percentageRate(counts.cancelledCount, rows.length);
      })
      .filter((rate): rate is number => rate != null);

    return {
      previousSameWeekdayAverageAppointments:
        Math.round(appointmentCounts.reduce((total, count) => total + count, 0) / validDays.length),
      previousSameWeekdayAverageNoShowRatePercent:
        noShowRates.length > 0
          ? Number((noShowRates.reduce((total, rate) => total + rate, 0) / noShowRates.length).toFixed(1))
          : null,
      previousSameWeekdayAverageCancellationRatePercent:
        cancellationRates.length > 0
          ? Number((cancellationRates.reduce((total, rate) => total + rate, 0) / cancellationRates.length).toFixed(1))
          : null,
    };
  } catch (error) {
    console.warn("[GT_V2Report][GT Growth AI] same-weekday appointment benchmark failed", {
      clinicCode: input.clinicCode,
      dateKey: input.dateKey,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return null;
  }
}

export async function buildTodayAppointmentReport(input: {
  clinicId?: string;
  clinicCode: string;
  clinicName?: string;
  timezone?: string;
  authorizationHeader?: string;
  referenceDate?: Date;
  dateKey?: string;
}) {
  const timezone = normalizeTimeZone(input.timezone);
  const { dateKey, rows } = await getTodayAppointmentsForClinic({
    clinicCode: input.clinicCode,
    timezone,
    authorizationHeader: input.authorizationHeader,
    referenceDate: input.referenceDate,
    dateKey: input.dateKey,
  });
  const counts = summarizeAppointmentCounts(rows);
  const appointments = mapAppointments(rows, timezone);
  const clinicName = input.clinicName || rows[0]?.ClinicName || input.clinicCode;
  const topServices = summarizeTopServices(rows);
  const therapistLoad = summarizeTherapistLoad(rows);
  const { busyHours, underutilizedHours } = summarizeAppointmentHourLoad(rows, timezone);
  const [completedCustomersWithoutFutureBookingCount, comparison] = await Promise.all([
    countCompletedCustomersWithoutFutureBooking({
      clinicCode: input.clinicCode,
      timezone,
      dateKey,
      rows,
      authorizationHeader: input.authorizationHeader,
    }),
    fetchSameWeekdayBenchmark({
      clinicCode: input.clinicCode,
      timezone,
      dateKey,
      authorizationHeader: input.authorizationHeader,
    }),
  ]);
  const cancellationRatePercent = percentageRate(counts.cancelledCount, rows.length);
  const noShowRatePercent = percentageRate(counts.noShowCount, rows.length);
  const premium = await hasFeatureAccess({
    clinicId: input.clinicId,
    feature: GT_GROWTH_AI_FEATURE_GATE,
    teaser: {
      insightCount: rows.length > 0 ? 1 : 0,
      opportunityCount: completedCustomersWithoutFutureBookingCount ? 1 : undefined,
    },
  });
  const gtGrowthAi = premium.enabled
    ? buildAppointmentReportAiPayload({
        dateKey,
        totalAppointments: rows.length,
        completedAppointments: counts.completedCount,
        upcomingAppointments: counts.upcomingCount,
        cancelledAppointments: counts.cancelledCount,
        noShowAppointments: counts.noShowCount,
        cancellationRatePercent,
        noShowRatePercent,
        busyHours,
        underutilizedHours,
        topServices: topServices.map((service) => ({ name: service.serviceName, count: service.count })),
        therapistLoad: therapistLoad.map((therapist) => ({ name: therapist.therapistName, count: therapist.count })),
        completedCustomersWithoutFutureBookingCount,
        comparison,
      })
    : undefined;

  return {
    clinicName,
    dateKey,
    timezone,
    totalAppointments: rows.length,
    upcomingCount: counts.upcomingCount,
    completedCount: counts.completedCount,
    cancelledCount: counts.cancelledCount,
    noShowCount: counts.noShowCount,
    cancellationRatePercent,
    noShowRatePercent,
    appointments,
    topServices,
    therapistLoad,
    busyHours,
    underutilizedHours,
    completedCustomersWithoutFutureBookingCount,
    premium,
    ...(gtGrowthAi ? { gtGrowthAi } : {}),
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
    `Cancellation rate: ${report.cancellationRatePercent === null ? "N/A" : `${report.cancellationRatePercent}%`}`,
    `No-show rate: ${report.noShowRatePercent === null ? "N/A" : `${report.noShowRatePercent}%`}`,
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

  const gtGrowthAiLines = formatGtGrowthAiTelegramSection(report.gtGrowthAi);
  if (gtGrowthAiLines.length > 0) {
    lines.push("", ...gtGrowthAiLines);
  }

  return lines.join("\n");
}

export async function sendTodayAppointmentReport(input: {
  chatId: string;
  clinicId?: string;
  clinicCode: string;
  clinicName?: string;
  timezone?: string;
  authorizationHeader?: string;
  referenceDate?: Date;
  dateKey?: string;
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
