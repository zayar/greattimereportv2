import {
  fetchApicoreBookingDetails,
  fetchApicoreOrdersWithPayments,
  type ApicoreBookingDetailsRow,
  type ApicoreOrderWithPaymentsRow,
} from "../apicore.service.js";
import {
  buildApicoreBookingDetailsDateRange,
  isApicoreBookingWallClockDateInRange,
} from "../apicore-booking-details-range.js";
import {
  buildWeeklySummaryReportAiPayload,
  percentageChange,
  percentageRate,
} from "../reports/report-ai-insights.service.js";
import { hasFeatureAccess } from "../feature-access.service.js";
import { getWeeklySummaryGrowthEvidence } from "../reports/gt-growth-ai-evidence.service.js";
import { GT_GROWTH_AI_FEATURE_GATE } from "../../types/report-ai.js";
import { sendTelegramMessage } from "./bot.service.js";
import { formatGtGrowthAiTelegramSection } from "./gt-growth-ai-message.js";
import { summarizeAppointmentCounts } from "./report.service.js";
import {
  buildUtcDayRangeForDateKeyInTimeZone,
  formatDateKeyInTimeZone,
  normalizeTimeZone,
} from "./time.js";
import {
  DEFAULT_WEEKLY_SUMMARY_SECTIONS,
  type WeeklySummaryCountItem,
  type WeeklySummaryReportSummary,
  type WeeklySummarySection,
} from "./types.js";

const PAGE_SIZE = 200;
const TOP_SERVICE_LIMIT = 5;
const BUSY_HOUR_LIMIT = 5;
const BUSY_DAY_LIMIT = 7;
const UNDERUTILIZED_LIMIT = 5;
const TELEGRAM_CHUNK_LIMIT = 3900;

type WeeklyPaymentRow = {
  paymentMethod: string;
  amount: number;
  sortKey: number;
};

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map((value) => Number(value));
  return new Date(Date.UTC(year, month - 1, day));
}

function addDaysToDateKey(dateKey: string, days: number) {
  const date = parseDateKey(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getPreviousCompletedWeekRange(referenceDate: Date, timezone: string) {
  const dateKey = formatDateKeyInTimeZone(referenceDate, timezone);
  const localDate = parseDateKey(dateKey);
  const dayOfWeek = localDate.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const currentWeekStartDateKey = addDaysToDateKey(dateKey, -daysSinceMonday);
  const weekStartDateKey = addDaysToDateKey(currentWeekStartDateKey, -7);
  const weekEndDateKey = addDaysToDateKey(currentWeekStartDateKey, -1);
  const startRange = buildUtcDayRangeForDateKeyInTimeZone(weekStartDateKey, timezone);
  const endRange = buildUtcDayRangeForDateKeyInTimeZone(weekEndDateKey, timezone);

  return {
    dateKey,
    weekStartDateKey,
    weekEndDateKey,
    startIso: startRange.startIso,
    endIso: endRange.endIso,
  };
}

function getWeekRangeForStartDate(input: {
  weekStartDateKey: string;
  timezone: string;
  referenceDate?: Date;
}) {
  const weekEndDateKey = addDaysToDateKey(input.weekStartDateKey, 6);
  const startRange = buildUtcDayRangeForDateKeyInTimeZone(input.weekStartDateKey, input.timezone);
  const endRange = buildUtcDayRangeForDateKeyInTimeZone(weekEndDateKey, input.timezone);

  return {
    dateKey: formatDateKeyInTimeZone(input.referenceDate ?? new Date(), input.timezone),
    weekStartDateKey: input.weekStartDateKey,
    weekEndDateKey,
    startIso: startRange.startIso,
    endIso: endRange.endIso,
  };
}

function getPreviousWeekRangeFromRange(range: {
  weekStartDateKey: string;
  weekEndDateKey: string;
  timezone: string;
}) {
  const weekStartDateKey = addDaysToDateKey(range.weekStartDateKey, -7);
  const weekEndDateKey = addDaysToDateKey(range.weekEndDateKey, -7);
  const startRange = buildUtcDayRangeForDateKeyInTimeZone(weekStartDateKey, range.timezone);
  const endRange = buildUtcDayRangeForDateKeyInTimeZone(weekEndDateKey, range.timezone);

  return {
    weekStartDateKey,
    weekEndDateKey,
    startIso: startRange.startIso,
    endIso: endRange.endIso,
  };
}

async function fetchAllAppointmentsForWeek(input: {
  clinicCode: string;
  weekStartDateKey: string;
  weekEndDateKey: string;
  authorizationHeader?: string;
}) {
  const rows: ApicoreBookingDetailsRow[] = [];
  const range = buildApicoreBookingDetailsDateRange({
    fromDate: input.weekStartDateKey,
    toDate: input.weekEndDateKey,
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
        isApicoreBookingWallClockDateInRange(row.FromTime, input.weekStartDateKey, input.weekEndDateKey),
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

async function fetchAllOrdersForWeek(input: {
  clinicId: string;
  startIso: string;
  endIso: string;
  authorizationHeader?: string;
}) {
  const rows: ApicoreOrderWithPaymentsRow[] = [];
  let skip = 0;
  let totalCount = Number.POSITIVE_INFINITY;

  while (rows.length < totalCount) {
    const result = await fetchApicoreOrdersWithPayments({
      clinicId: input.clinicId,
      startDate: input.startIso,
      endDate: input.endIso,
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

  return rows;
}

function parseNumber(value: unknown) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (value && typeof value === "object" && "value" in value) {
    return Number((value as { value: unknown }).value ?? 0);
  }

  return Number(value ?? 0);
}

function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString("en-US")} MMK`;
}

function titleCasePaymentMethod(value: string) {
  return value
    .toLowerCase()
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizePaymentMethod(value: string | null | undefined) {
  const raw = (value ?? "").trim();
  const normalized = raw.replace(/[\s-]+/g, "_").toUpperCase();

  switch (normalized) {
    case "CASH":
      return "Cash";
    case "KBZPAY":
    case "KBZ_PAY":
    case "K_PAY":
    case "KPAY":
      return "KBZPay";
    case "AYAPAY":
    case "AYA_PAY":
      return "AYA Pay";
    case "WAVEPAY":
    case "WAVE_PAY":
      return "WavePay";
    case "CBPAY":
    case "CB_PAY":
      return "CB Pay";
    case "BANK_TRANSFER":
    case "BANK":
    case "TRANSFER":
      return "Bank Transfer";
    case "UABPAY":
    case "UAB_PAY":
      return "UAB Pay";
    case "GIFT_VOUCHER":
      return "Gift Voucher";
    default:
      return raw ? titleCasePaymentMethod(raw) : "Unknown";
  }
}

function buildFallbackPaymentRow(input: {
  order: ApicoreOrderWithPaymentsRow;
  startTime: number;
  endTime: number;
}) {
  const createdAt = new Date(input.order.created_at);
  const createdTime = createdAt.getTime();
  if (Number.isNaN(createdTime) || createdTime < input.startTime || createdTime > input.endTime) {
    return null;
  }

  const paymentStatus = (input.order.payment_status ?? "").trim().toUpperCase();
  if (!["PAID", "PARTIAL_PAID"].includes(paymentStatus)) {
    return null;
  }

  const netTotal = parseNumber(input.order.net_total);
  const total = parseNumber(input.order.total);
  const balance = parseNumber(input.order.balance);
  const amount = paymentStatus === "PAID" ? netTotal : Math.max(0, total - balance);

  if (!(amount > 0)) {
    return null;
  }

  return {
    paymentMethod: normalizePaymentMethod(input.order.payment_method),
    amount,
    sortKey: createdTime,
  } satisfies WeeklyPaymentRow;
}

function mapPaymentRows(input: {
  orders: ApicoreOrderWithPaymentsRow[];
  startIso: string;
  endIso: string;
}) {
  const startTime = new Date(input.startIso).getTime();
  const endTime = new Date(input.endIso).getTime();
  const rows: WeeklyPaymentRow[] = [];

  input.orders.forEach((order) => {
    const matchedPayments = (order.payments ?? [])
      .map((payment) => {
        const paymentDate = new Date(payment.payment_date);
        const paymentTime = paymentDate.getTime();
        const amount = parseNumber(payment.payment_amount);

        if (Number.isNaN(paymentTime) || paymentTime < startTime || paymentTime > endTime || !(amount > 0)) {
          return null;
        }

        return {
          paymentMethod: normalizePaymentMethod(payment.payment_method),
          amount,
          sortKey: paymentTime,
        } satisfies WeeklyPaymentRow;
      })
      .filter((payment): payment is WeeklyPaymentRow => Boolean(payment));

    if (matchedPayments.length > 0) {
      rows.push(...matchedPayments);
      return;
    }

    const fallbackPayment = buildFallbackPaymentRow({
      order,
      startTime,
      endTime,
    });

    if (fallbackPayment) {
      rows.push(fallbackPayment);
    }
  });

  return rows.sort((left, right) => right.sortKey - left.sortKey);
}

function summarizeByLabel(rows: ApicoreBookingDetailsRow[], getter: (row: ApicoreBookingDetailsRow) => string) {
  const summary = new Map<string, number>();

  rows.forEach((row) => {
    const label = getter(row).trim() || "Unknown";
    summary.set(label, (summary.get(label) ?? 0) + 1);
  });

  return [...summary.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

function summarizePaymentMethods(payments: WeeklyPaymentRow[]) {
  const summary = new Map<string, { count: number; amount: number }>();

  payments.forEach((payment) => {
    const current = summary.get(payment.paymentMethod) ?? { count: 0, amount: 0 };
    current.count += 1;
    current.amount += payment.amount;
    summary.set(payment.paymentMethod, current);
  });

  return [...summary.entries()]
    .map(([paymentMethod, data]) => ({
      paymentMethod,
      count: data.count,
      amount: data.amount,
    }))
    .sort(
      (left, right) =>
        right.amount - left.amount ||
        right.count - left.count ||
        left.paymentMethod.localeCompare(right.paymentMethod),
    );
}

function summarizeTopServices(serviceSummary: WeeklySummaryCountItem[]) {
  const totalServices = serviceSummary.reduce((total, service) => total + service.count, 0);

  return serviceSummary.slice(0, TOP_SERVICE_LIMIT).map((service) => ({
    ...service,
    percentage: totalServices > 0 ? Math.round((service.count / totalServices) * 100) : null,
  }));
}

function formatBusyHourLabel(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    hour: "numeric",
    hour12: true,
  }).formatToParts(date);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Unknown day";
  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  const dayPeriod = parts.find((part) => part.type === "dayPeriod")?.value?.toUpperCase() ?? "";

  return [weekday, hour, dayPeriod].filter(Boolean).join(" ");
}

function summarizeBusyHours(rows: ApicoreBookingDetailsRow[], timezone: string) {
  const summary = new Map<string, { label: string; count: number }>();

  rows.forEach((row) => {
    const date = new Date(row.FromTime);
    if (Number.isNaN(date.getTime())) {
      return;
    }

    const dateKey = formatDateKeyInTimeZone(date, timezone);
    const hourKey = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(date);
    const key = `${dateKey}-${hourKey}`;
    const current = summary.get(key) ?? {
      label: formatBusyHourLabel(date, timezone),
      count: 0,
    };
    current.count += 1;
    summary.set(key, current);
  });

  return [...summary.values()]
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, BUSY_HOUR_LIMIT);
}

function summarizeUnderutilizedHours(rows: ApicoreBookingDetailsRow[], timezone: string) {
  const summary = new Map<string, { label: string; count: number }>();

  rows.forEach((row) => {
    const date = new Date(row.FromTime);
    if (Number.isNaN(date.getTime())) {
      return;
    }

    const dateKey = formatDateKeyInTimeZone(date, timezone);
    const hourKey = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(date);
    const key = `${dateKey}-${hourKey}`;
    const current = summary.get(key) ?? {
      label: formatBusyHourLabel(date, timezone),
      count: 0,
    };
    current.count += 1;
    summary.set(key, current);
  });

  const slots = [...summary.values()];
  if (slots.length < 2) {
    return [];
  }

  const peak = Math.max(...slots.map((slot) => slot.count));
  const threshold = Math.max(1, Math.floor(peak * 0.5));

  return slots
    .filter((slot) => slot.count < threshold)
    .sort((left, right) => left.count - right.count || left.label.localeCompare(right.label))
    .slice(0, UNDERUTILIZED_LIMIT);
}

function formatWeekdayLabel(dateKey: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(parseDateKey(dateKey));
}

function summarizeBusyDays(rows: ApicoreBookingDetailsRow[], timezone: string, weekStartDateKey: string) {
  const counts = new Map<string, number>();

  rows.forEach((row) => {
    const date = new Date(row.FromTime);
    if (Number.isNaN(date.getTime())) {
      return;
    }

    const dateKey = formatDateKeyInTimeZone(date, timezone);
    counts.set(dateKey, (counts.get(dateKey) ?? 0) + 1);
  });

  const days = Array.from({ length: 7 }, (_, index) => {
    const dateKey = addDaysToDateKey(weekStartDateKey, index);
    return {
      label: formatWeekdayLabel(dateKey),
      count: counts.get(dateKey) ?? 0,
    };
  });
  const busyDays = [...days]
    .filter((day) => day.count > 0)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, BUSY_DAY_LIMIT);
  const peak = Math.max(...days.map((day) => day.count));

  if (peak <= 0) {
    return {
      busyDays,
      underutilizedDays: [],
    };
  }

  const threshold = Math.max(1, Math.floor(peak * 0.5));

  return {
    busyDays,
    underutilizedDays: days
      .filter((day) => day.count < threshold)
      .sort((left, right) => left.count - right.count || left.label.localeCompare(right.label))
      .slice(0, UNDERUTILIZED_LIMIT),
  };
}

async function fetchOptionalPreviousWeekData(input: {
  clinicId: string;
  clinicCode: string;
  timezone: string;
  weekStartDateKey: string;
  weekEndDateKey: string;
  authorizationHeader?: string;
}) {
  const previousRange = getPreviousWeekRangeFromRange({
    weekStartDateKey: input.weekStartDateKey,
    weekEndDateKey: input.weekEndDateKey,
    timezone: input.timezone,
  });

  try {
    const [appointments, orders] = await Promise.all([
      fetchAllAppointmentsForWeek({
        clinicCode: input.clinicCode,
        weekStartDateKey: previousRange.weekStartDateKey,
        weekEndDateKey: previousRange.weekEndDateKey,
        authorizationHeader: input.authorizationHeader,
      }),
      fetchAllOrdersForWeek({
        clinicId: input.clinicId,
        startIso: previousRange.startIso,
        endIso: previousRange.endIso,
        authorizationHeader: input.authorizationHeader,
      }),
    ]);

    return {
      range: previousRange,
      appointments,
      orders,
    };
  } catch (error) {
    console.warn("[GT_V2Report][GT Growth AI] previous-week summary comparison failed", {
      clinicId: input.clinicId,
      clinicCode: input.clinicCode,
      weekStartDateKey: input.weekStartDateKey,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return null;
  }
}

function normalizeSections(sections: WeeklySummarySection[] | undefined) {
  if (!sections?.length) {
    return [...DEFAULT_WEEKLY_SUMMARY_SECTIONS];
  }

  return [...new Set(sections)];
}

function hasSection(report: WeeklySummaryReportSummary, section: WeeklySummarySection) {
  return report.selectedSections.includes(section);
}

function pushCountSection(
  lines: string[],
  items: WeeklySummaryCountItem[],
  emptyText: string,
  formatter: (item: WeeklySummaryCountItem) => string,
) {
  if (items.length === 0) {
    lines.push(emptyText);
    return;
  }

  items.forEach((item) => lines.push(formatter(item)));
}

export async function buildWeeklySummaryReport(input: {
  clinicId: string;
  clinicCode: string;
  clinicName?: string;
  timezone?: string;
  sections?: WeeklySummarySection[];
  authorizationHeader?: string;
  referenceDate?: Date;
  weekStartDateKey?: string;
}) {
  const timezone = normalizeTimeZone(input.timezone);
  const range = input.weekStartDateKey
    ? getWeekRangeForStartDate({
        weekStartDateKey: input.weekStartDateKey,
        timezone,
        referenceDate: input.referenceDate,
      })
    : getPreviousCompletedWeekRange(input.referenceDate ?? new Date(), timezone);
  const [appointments, orders] = await Promise.all([
    fetchAllAppointmentsForWeek({
      clinicCode: input.clinicCode,
      weekStartDateKey: range.weekStartDateKey,
      weekEndDateKey: range.weekEndDateKey,
      authorizationHeader: input.authorizationHeader,
    }),
    fetchAllOrdersForWeek({
      clinicId: input.clinicId,
      startIso: range.startIso,
      endIso: range.endIso,
      authorizationHeader: input.authorizationHeader,
    }),
  ]);
  const previousWeekData = await fetchOptionalPreviousWeekData({
    clinicId: input.clinicId,
    clinicCode: input.clinicCode,
    timezone,
    weekStartDateKey: range.weekStartDateKey,
    weekEndDateKey: range.weekEndDateKey,
    authorizationHeader: input.authorizationHeader,
  });
  const appointmentCounts = summarizeAppointmentCounts(appointments);
  const serviceSummary = summarizeByLabel(appointments, (row) => row.ServiceName);
  const therapistSummary = summarizeByLabel(appointments, (row) => row.PractitionerName || "Unassigned");
  const payments = mapPaymentRows({
    orders,
    startIso: range.startIso,
    endIso: range.endIso,
  });
  const paymentMethods = summarizePaymentMethods(payments);
  const totalAppointments = appointments.length;
  const totalPaymentAmount = payments.reduce((total, payment) => total + payment.amount, 0);
  const clinicName = input.clinicName || appointments[0]?.ClinicName || input.clinicCode;
  const previousAppointmentCounts = previousWeekData
    ? summarizeAppointmentCounts(previousWeekData.appointments)
    : null;
  const previousPayments = previousWeekData
    ? mapPaymentRows({
        orders: previousWeekData.orders,
        startIso: previousWeekData.range.startIso,
        endIso: previousWeekData.range.endIso,
      })
    : null;
  const previousWeekTotalPaymentAmount =
    previousPayments?.reduce((total, payment) => total + payment.amount, 0) ?? null;
  const previousWeekAppointmentCount = previousWeekData?.appointments.length ?? null;
  const previousWeekCancelledAppointments = previousAppointmentCounts?.cancelledCount ?? null;
  const weekOverWeekRevenueChangePercent = percentageChange(totalPaymentAmount, previousWeekTotalPaymentAmount);
  const weekOverWeekAppointmentChangePercent = percentageChange(totalAppointments, previousWeekAppointmentCount);
  const { busyDays, underutilizedDays } = summarizeBusyDays(
    appointments,
    timezone,
    range.weekStartDateKey,
  );
  const busyHours = summarizeBusyHours(appointments, timezone);
  const underutilizedHours = summarizeUnderutilizedHours(appointments, timezone);
  const premium = await hasFeatureAccess({
    clinicId: input.clinicId,
    feature: GT_GROWTH_AI_FEATURE_GATE,
    teaser: {
      insightCount: totalAppointments > 0 || totalPaymentAmount > 0 ? 1 : 0,
      opportunityCount: underutilizedDays.length > 0 ? 1 : undefined,
    },
  });
  const previousRangeForEvidence = getPreviousWeekRangeFromRange({
    weekStartDateKey: range.weekStartDateKey,
    weekEndDateKey: range.weekEndDateKey,
    timezone,
  });
  const averageRevenuePerCompletedCustomer =
    appointmentCounts.completedCount > 0 ? totalPaymentAmount / appointmentCounts.completedCount : null;
  const growthEvidence = premium.enabled
    ? await getWeeklySummaryGrowthEvidence({
        clinicCode: input.clinicCode,
        weekStartDateKey: range.weekStartDateKey,
        weekEndDateKey: range.weekEndDateKey,
        previousWeekStartDateKey: previousRangeForEvidence.weekStartDateKey,
        previousWeekEndDateKey: previousRangeForEvidence.weekEndDateKey,
        totalWeeklyRevenue: totalPaymentAmount,
        averageRevenuePerCompletedCustomer,
      })
    : null;
  const packageSalesSummary =
    growthEvidence?.packageSales != null
      ? `${formatMoney(growthEvidence.packageSales.totalAmount)} from ${growthEvidence.packageSales.count.toLocaleString("en-US")} package sale(s)`
      : null;
  const customerRetentionOpportunityCount =
    growthEvidence?.customerRebookingOpportunity?.customersWithoutFutureBooking ?? null;
  const gtGrowthAi = premium.enabled
    ? buildWeeklySummaryReportAiPayload({
        weekStartDateKey: range.weekStartDateKey,
        weekEndDateKey: range.weekEndDateKey,
        weeklyAppointmentCount: totalAppointments,
        weeklyCompletedAppointments: appointmentCounts.completedCount,
        weeklyCancelledAppointments: appointmentCounts.cancelledCount,
        weeklyNoShowAppointments: appointmentCounts.noShowCount,
        weeklyRevenue: totalPaymentAmount,
        weekOverWeekRevenueChangePercent,
        weekOverWeekAppointmentChangePercent,
        previousWeekRevenue: previousWeekTotalPaymentAmount,
        previousWeekAppointmentCount,
        previousWeekCancelledAppointments,
        topServices: serviceSummary.slice(0, TOP_SERVICE_LIMIT),
        topTherapists: therapistSummary.slice(0, TOP_SERVICE_LIMIT),
        busyDays,
        underutilizedDays,
        underutilizedHours,
        packageSalesSummary,
        packageSalesEvidence: growthEvidence?.packageSales,
        serviceRevenueEvidence: growthEvidence?.serviceRevenue,
        customerRetentionOpportunityCount,
        customerRebookingOpportunityEvidence: growthEvidence?.customerRebookingOpportunity,
      })
    : undefined;

  return {
    clinicName,
    dateKey: range.dateKey,
    weekStartDateKey: range.weekStartDateKey,
    weekEndDateKey: range.weekEndDateKey,
    timezone,
    selectedSections: normalizeSections(input.sections),
    appointmentSummary: {
      totalAppointments,
      completedAppointments: appointmentCounts.completedCount,
      cancelledAppointments: appointmentCounts.cancelledCount,
      noShowAppointments: appointmentCounts.noShowCount,
      completionRatePercent:
        totalAppointments > 0 ? Math.round((appointmentCounts.completedCount / totalAppointments) * 100) : null,
      cancellationRatePercent: percentageRate(appointmentCounts.cancelledCount, totalAppointments),
      noShowRatePercent: percentageRate(appointmentCounts.noShowCount, totalAppointments),
    },
    serviceSummary,
    therapistSummary,
    paymentSummary: {
      totalPaymentAmount,
      paymentCount: payments.length,
      paymentMethods,
      previousWeekTotalPaymentAmount,
      weekOverWeekRevenueChangePercent,
    },
    topServices: summarizeTopServices(serviceSummary),
    busyHours,
    busyDays,
    underutilizedDays,
    underutilizedHours,
    weekOverWeekAppointmentChangePercent,
    previousWeekAppointmentCount,
    previousWeekCancelledAppointments,
    packageSalesSummary,
    customerRetentionOpportunityCount,
    premium,
    ...(gtGrowthAi ? { gtGrowthAi } : {}),
  } satisfies WeeklySummaryReportSummary;
}

export function formatWeeklySummaryTelegramMessage(report: WeeklySummaryReportSummary) {
  const lines: string[] = [
    "📊 Weekly Summary Report",
    "",
    `Clinic: ${report.clinicName}`,
    "",
    "Week:",
    `${report.weekStartDateKey} → ${report.weekEndDateKey}`,
    `Timezone: ${report.timezone}`,
  ];

  if (hasSection(report, "appointment_summary")) {
    lines.push("", "📅 Appointments");
    lines.push(`Total: ${report.appointmentSummary.totalAppointments}`);
    lines.push(`Completed: ${report.appointmentSummary.completedAppointments}`);
    lines.push(`Cancelled: ${report.appointmentSummary.cancelledAppointments}`);
    lines.push(`No-show: ${report.appointmentSummary.noShowAppointments}`);
    lines.push(
      `Cancellation rate: ${
        report.appointmentSummary.cancellationRatePercent === null
          ? "No appointment data"
          : `${report.appointmentSummary.cancellationRatePercent}%`
      }`,
    );
    lines.push(
      `No-show rate: ${
        report.appointmentSummary.noShowRatePercent === null
          ? "No appointment data"
          : `${report.appointmentSummary.noShowRatePercent}%`
      }`,
    );
    lines.push(
      `Completion rate: ${
        report.appointmentSummary.completionRatePercent === null
          ? "No appointment data"
          : `${report.appointmentSummary.completionRatePercent}%`
      }`,
    );
  }

  if (hasSection(report, "service_summary")) {
    lines.push("", "💆 Service Summary");
    pushCountSection(
      lines,
      report.serviceSummary,
      "No services found this week.",
      (service) => `${service.name} - ${service.count}`,
    );
  }

  if (hasSection(report, "top_services")) {
    lines.push("", "🏆 Top Services");
    if (report.topServices.length === 0) {
      lines.push("No services found this week.");
    } else {
      report.topServices.forEach((service, index) => {
        const percentageText = service.percentage === null ? "" : ` (${service.percentage}%)`;
        lines.push(`${index + 1}. ${service.name} - ${service.count}${percentageText}`);
      });
    }
  }

  if (hasSection(report, "therapist_summary")) {
    lines.push("", "👩‍⚕️ Therapist Summary");
    pushCountSection(
      lines,
      report.therapistSummary,
      "No therapists found this week.",
      (therapist) => `${therapist.name} - ${therapist.count} appointments`,
    );
  }

  if (hasSection(report, "payment_summary")) {
    lines.push("", "💰 Payments by Method");
    lines.push(`Total received: ${formatMoney(report.paymentSummary.totalPaymentAmount)}`);
    lines.push(`Transactions: ${report.paymentSummary.paymentCount}`);
    if (report.paymentSummary.previousWeekTotalPaymentAmount !== null) {
      lines.push(`Last week received: ${formatMoney(report.paymentSummary.previousWeekTotalPaymentAmount)}`);
    }
    if (report.paymentSummary.weekOverWeekRevenueChangePercent !== null) {
      lines.push(`Revenue WoW: ${report.paymentSummary.weekOverWeekRevenueChangePercent}%`);
    }
    if (report.paymentSummary.paymentMethods.length === 0) {
      lines.push("No payment records found this week.");
    } else {
      report.paymentSummary.paymentMethods.forEach((entry) => {
        lines.push(`${entry.paymentMethod} - ${formatMoney(entry.amount)} (${entry.count})`);
      });
    }
  }

  if (hasSection(report, "busy_hours")) {
    lines.push("", "🔥 Busy Hours");
    if (report.busyHours.length === 0) {
      lines.push("No appointment time slots found this week.");
    } else {
      report.busyHours.forEach((entry) => {
        lines.push(`${entry.label} - ${entry.count} appointments`);
      });
    }
  }

  const gtGrowthAiLines = formatGtGrowthAiTelegramSection(report.gtGrowthAi);
  if (gtGrowthAiLines.length > 0) {
    lines.push("", ...gtGrowthAiLines);
  }

  return lines.join("\n");
}

function splitTelegramMessage(text: string) {
  if (text.length <= TELEGRAM_CHUNK_LIMIT) {
    return [text];
  }

  const chunks: string[] = [];
  let current = "";

  text.split("\n").forEach((line) => {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > TELEGRAM_CHUNK_LIMIT && current) {
      chunks.push(current);
      current = line;
      return;
    }

    current = next;
  });

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

export async function sendWeeklySummaryReport(input: {
  chatId: string;
  clinicId: string;
  clinicCode: string;
  clinicName?: string;
  timezone?: string;
  sections?: WeeklySummarySection[];
  authorizationHeader?: string;
  referenceDate?: Date;
}) {
  const report = await buildWeeklySummaryReport(input);
  const message = formatWeeklySummaryTelegramMessage(report);
  const chunks = splitTelegramMessage(message);

  for (const chunk of chunks) {
    await sendTelegramMessage(input.chatId, chunk);
  }

  return {
    sentAt: new Date().toISOString(),
    report,
    message,
  };
}
