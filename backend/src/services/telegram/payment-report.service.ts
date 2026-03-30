import {
  fetchApicoreOrdersWithPayments,
  type ApicoreOrderWithPaymentsRow,
} from "../apicore.service.js";
import { sendTelegramMessage } from "./bot.service.js";
import {
  buildUtcDayRangeForDateKeyInTimeZone,
  formatDateKeyInTimeZone,
  formatDisplayTimeInTimeZone,
  normalizeTimeZone,
} from "./time.js";
import type { TodayPaymentReportItem, TodayPaymentReportSummary } from "./types.js";

const PAGE_SIZE = 200;
const PAYMENT_PREVIEW_LIMIT = 10;
const METHOD_PREVIEW_LIMIT = 6;
const SELLER_PREVIEW_LIMIT = 5;

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

function normalizePaymentMethod(value: string | null | undefined) {
  const normalized = (value ?? "").trim().toUpperCase();

  switch (normalized) {
    case "AYAPAY":
      return "AYA Pay";
    case "WAVEPAY":
      return "WavePay";
    case "UABPAY":
      return "UAB Pay";
    case "GIFT_VOUCHER":
      return "Gift Voucher";
    default:
      return normalized || "UNKNOWN";
  }
}

function getCustomerName(order: ApicoreOrderWithPaymentsRow) {
  return order.member?.clinic_members?.[0]?.name?.trim() || order.member?.name?.trim() || "Unknown customer";
}

function getSellerName(order: ApicoreOrderWithPaymentsRow) {
  return order.seller?.display_name?.trim() || order.user?.name?.trim() || "Unknown seller";
}

function buildFallbackPaymentRow(input: {
  order: ApicoreOrderWithPaymentsRow;
  timezone: string;
  startTime: number;
  endTime: number;
}) {
  const createdAt = new Date(input.order.created_at);
  if (Number.isNaN(createdAt.getTime())) {
    return null;
  }

  const createdTime = createdAt.getTime();
  if (createdTime < input.startTime || createdTime > input.endTime) {
    return null;
  }

  const paymentStatus = (input.order.payment_status ?? "").trim().toUpperCase();
  if (!["PAID", "PARTIAL_PAID"].includes(paymentStatus)) {
    return null;
  }

  const netTotal = parseNumber(input.order.net_total);
  const total = parseNumber(input.order.total);
  const balance = parseNumber(input.order.balance);
  const fallbackAmount = paymentStatus === "PAID" ? netTotal : Math.max(0, total - balance);

  if (!(fallbackAmount > 0)) {
    return null;
  }

  return {
    time: formatDisplayTimeInTimeZone(createdAt, input.timezone),
    customerName: getCustomerName(input.order),
    invoiceNumber: input.order.order_id?.trim() || "Unknown invoice",
    paymentMethod: normalizePaymentMethod(input.order.payment_method),
    amount: fallbackAmount,
    sellerName: getSellerName(input.order),
    sortKey: createdTime,
  };
}

function mapPaymentRows(input: {
  orders: ApicoreOrderWithPaymentsRow[];
  timezone: string;
  startIso: string;
  endIso: string;
}) {
  const startTime = new Date(input.startIso).getTime();
  const endTime = new Date(input.endIso).getTime();
  const rows: Array<TodayPaymentReportItem & { sortKey: number }> = [];

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
          time: formatDisplayTimeInTimeZone(paymentDate, input.timezone),
          customerName: getCustomerName(order),
          invoiceNumber: order.order_id?.trim() || "Unknown invoice",
          paymentMethod: normalizePaymentMethod(payment.payment_method),
          amount,
          sellerName: getSellerName(order),
          sortKey: paymentTime,
        };
      })
      .filter((payment): payment is TodayPaymentReportItem & { sortKey: number } => Boolean(payment));

    if (matchedPayments.length > 0) {
      rows.push(...matchedPayments);
      return;
    }

    const fallbackRow = buildFallbackPaymentRow({
      order,
      timezone: input.timezone,
      startTime,
      endTime,
    });

    if (fallbackRow) {
      rows.push(fallbackRow);
    }
  });

  return rows.sort((left, right) => right.sortKey - left.sortKey);
}

function summarizeByMethod(payments: Array<TodayPaymentReportItem & { sortKey: number }>) {
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
    .sort((left, right) => right.amount - left.amount || right.count - left.count || left.paymentMethod.localeCompare(right.paymentMethod))
    .slice(0, METHOD_PREVIEW_LIMIT);
}

function summarizeBySeller(payments: Array<TodayPaymentReportItem & { sortKey: number }>) {
  const summary = new Map<string, { count: number; amount: number }>();

  payments.forEach((payment) => {
    const current = summary.get(payment.sellerName) ?? { count: 0, amount: 0 };
    current.count += 1;
    current.amount += payment.amount;
    summary.set(payment.sellerName, current);
  });

  return [...summary.entries()]
    .map(([sellerName, data]) => ({
      sellerName,
      count: data.count,
      amount: data.amount,
    }))
    .sort((left, right) => right.amount - left.amount || right.count - left.count || left.sellerName.localeCompare(right.sellerName))
    .slice(0, SELLER_PREVIEW_LIMIT);
}

async function fetchAllOrdersForTodayPayments(input: {
  clinicId: string;
  timezone: string;
  authorizationHeader?: string;
  referenceDate?: Date;
}) {
  const dateKey = formatDateKeyInTimeZone(input.referenceDate ?? new Date(), input.timezone);
  const { startIso, endIso } = buildUtcDayRangeForDateKeyInTimeZone(dateKey, input.timezone);

  const rows: ApicoreOrderWithPaymentsRow[] = [];
  let skip = 0;
  let totalCount = Number.POSITIVE_INFINITY;

  while (rows.length < totalCount) {
    const result = await fetchApicoreOrdersWithPayments({
      clinicId: input.clinicId,
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
    startIso,
    endIso,
    rows,
  };
}

export async function buildTodayPaymentReport(input: {
  clinicId: string;
  clinicName?: string;
  timezone?: string;
  authorizationHeader?: string;
  referenceDate?: Date;
}) {
  const timezone = normalizeTimeZone(input.timezone);
  const { dateKey, startIso, endIso, rows } = await fetchAllOrdersForTodayPayments({
    clinicId: input.clinicId,
    timezone,
    authorizationHeader: input.authorizationHeader,
    referenceDate: input.referenceDate,
  });
  const payments = mapPaymentRows({
    orders: rows,
    timezone,
    startIso,
    endIso,
  });
  const totalPaymentAmount = payments.reduce((total, payment) => total + payment.amount, 0);
  const paidInvoiceCount = new Set(payments.map((payment) => payment.invoiceNumber)).size;

  return {
    clinicName: input.clinicName || "Clinic",
    dateKey,
    timezone,
    totalPaymentAmount,
    paidInvoiceCount,
    paymentCount: payments.length,
    payments: payments.slice(0, PAYMENT_PREVIEW_LIMIT).map(({ sortKey: _sortKey, ...payment }) => payment),
    paymentMethods: summarizeByMethod(payments),
    sellerTotals: summarizeBySeller(payments),
  } satisfies TodayPaymentReportSummary;
}

export function formatTodayPaymentTelegramMessage(report: TodayPaymentReportSummary) {
  const lines: string[] = [
    "💸 ယနေ့ Payment Report",
    `Clinic: ${report.clinicName}`,
    `Date: ${report.dateKey}`,
    `Timezone: ${report.timezone}`,
    "",
    `စုစုပေါင်း payment amount: ${formatMoney(report.totalPaymentAmount)}`,
    `Paid invoices: ${report.paidInvoiceCount}`,
    `Payment records: ${report.paymentCount}`,
  ];

  if (report.paymentMethods.length > 0) {
    lines.push("", "💳 Payment methods");
    report.paymentMethods.forEach((entry) => {
      lines.push(`${entry.paymentMethod} - ${formatMoney(entry.amount)} (${entry.count})`);
    });
  }

  lines.push("", "🧾 Recent payments");
  if (report.payments.length === 0) {
    lines.push("ယနေ့ payment record မရှိသေးပါ။");
  } else {
    report.payments.forEach((payment) => {
      lines.push(
        `${payment.time} - ${payment.customerName} - ${payment.invoiceNumber} - ${payment.paymentMethod} - ${formatMoney(payment.amount)}`,
      );
    });
  }

  const remainingPayments = report.paymentCount - report.payments.length;
  if (remainingPayments > 0) {
    lines.push(`+${remainingPayments} more payments`);
  }

  if (report.sellerTotals.length > 0) {
    lines.push("", "👤 Top sellers");
    report.sellerTotals.forEach((entry) => {
      lines.push(`${entry.sellerName} - ${formatMoney(entry.amount)} (${entry.count})`);
    });
  }

  return lines.join("\n");
}

export async function sendTodayPaymentReport(input: {
  chatId: string;
  clinicId: string;
  clinicName?: string;
  timezone?: string;
  authorizationHeader?: string;
  referenceDate?: Date;
}) {
  const report = await buildTodayPaymentReport(input);
  const message = formatTodayPaymentTelegramMessage(report);
  await sendTelegramMessage(input.chatId, message);

  return {
    sentAt: new Date().toISOString(),
    report,
    message,
  };
}
