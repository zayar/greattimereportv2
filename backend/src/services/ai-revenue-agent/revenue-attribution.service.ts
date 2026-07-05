import { analyticsTables } from "../../config/bigquery.js";
import type { SessionUser } from "../../types/auth.js";
import type {
  AiRevenueAction,
  AiRevenueAttributionType,
  AiRevenueRevenueInfo,
} from "../../types/ai-revenue-agent.js";
import { HttpError } from "../../utils/http-error.js";
import { runAnalyticsQuery } from "../bigquery.service.js";
import { getPackagePortalCustomerHoldings } from "../reports/package-portal.service.js";
import * as repository from "./ai-revenue-agent.repository.js";

type PaymentAttributionRow = {
  dateKey: string;
  invoiceNumber: string;
  bookingId: string | null;
  customerName: string | null;
  memberId: string | null;
  phoneNumber: string | null;
  paymentNote: string | null;
  invoiceNetTotal: number | string | null;
  serviceNames: string | null;
};

function actorFromUser(user: SessionUser | undefined) {
  if (!user) {
    return null;
  }

  return {
    userId: user.userId ?? user.uid ?? null,
    email: user.email ?? null,
    name: user.name ?? null,
  };
}

function nowIso() {
  return new Date().toISOString();
}

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function parseNumber(value: unknown) {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (value && typeof value === "object" && "value" in value) {
    return Number((value as { value: unknown }).value);
  }
  return Number(value ?? 0);
}

function normalizeDigits(value: unknown) {
  return cleanText(value).replace(/\D/g, "");
}

function normalizeTextKey(value: unknown) {
  return cleanText(value).replace(/\s+/g, " ").toLowerCase();
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateKeyFromIso(value?: string | null) {
  if (!value) {
    return null;
  }

  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function attributionStartDate(action: AiRevenueAction) {
  return (
    dateKeyFromIso(action.message.sentAt) ??
    dateKeyFromIso(action.message.lastInboundAt) ??
    dateKeyFromIso(action.appointment.cameAt) ??
    action.dateKey
  );
}

function sameCustomer(action: AiRevenueAction, row: PaymentAttributionRow) {
  const actionMemberId = normalizeTextKey(action.customer.memberId);
  const rowMemberId = normalizeTextKey(row.memberId);
  if (actionMemberId && rowMemberId && actionMemberId === rowMemberId) {
    return true;
  }

  const actionPhone = normalizeDigits(action.customer.phoneNumber);
  const rowPhone = normalizeDigits(row.phoneNumber);
  if (actionPhone && rowPhone && actionPhone === rowPhone) {
    return true;
  }

  const actionName = normalizeTextKey(action.customer.customerName);
  const rowName = normalizeTextKey(row.customerName);
  return Boolean(actionName && rowName && actionName === rowName);
}

function rowReferencesAction(action: AiRevenueAction, row: PaymentAttributionRow) {
  const actionId = action.id.toLowerCase();
  const paymentNote = cleanText(row.paymentNote).toLowerCase();
  const invoiceNumber = cleanText(row.invoiceNumber).toLowerCase();
  return paymentNote.includes(actionId) || invoiceNumber.includes(actionId);
}

function sameBooking(action: AiRevenueAction, row: PaymentAttributionRow) {
  const bookingId = normalizeTextKey(action.appointment.bookingId);
  return Boolean(bookingId && normalizeTextKey(row.bookingId) === bookingId);
}

function moneyAmount(row: PaymentAttributionRow) {
  return Math.max(0, parseNumber(row.invoiceNetTotal));
}

function buildRevenueNote(input: {
  attributionType: AiRevenueAttributionType;
  row?: PaymentAttributionRow | null;
  note?: string | null;
  packageSessionsRecovered?: number;
}) {
  const pieces: string[] = [];
  if (input.note) {
    pieces.push(input.note);
  }
  if (input.row) {
    pieces.push(
      `Matched invoice ${input.row.invoiceNumber} on ${input.row.dateKey}${
        input.row.serviceNames ? ` (${input.row.serviceNames})` : ""
      }.`,
    );
  }
  if (input.attributionType === "package_recovery") {
    pieces.push(`Recovered ${input.packageSessionsRecovered ?? 0} prepaid package/session use(s).`);
  }
  return pieces.join(" ");
}

async function fetchPaidInvoices(input: {
  clinicCode: string;
  fromDate: string;
  toDate: string;
}) {
  return runAnalyticsQuery<PaymentAttributionRow>(
    `
      SELECT
        FORMAT_DATE('%Y-%m-%d', DATE(OrderCreatedDate)) AS dateKey,
        InvoiceNumber AS invoiceNumber,
        CAST(BookingID AS STRING) AS bookingId,
        MAX(CustomerName) AS customerName,
        MAX(CAST(MemberId AS STRING)) AS memberId,
        MAX(CustomerPhoneNumber) AS phoneNumber,
        MAX(PaymentNote) AS paymentNote,
        MAX(CAST(NetTotal AS FLOAT64)) AS invoiceNetTotal,
        STRING_AGG(DISTINCT NULLIF(COALESCE(ServiceName, ServicePackageName), ''), ', ') AS serviceNames
      FROM ${analyticsTables.mainPaymentView}
      WHERE DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate
        AND LOWER(ClinicCode) = LOWER(@clinicCode)
        AND UPPER(COALESCE(PaymentStatus, '')) = 'PAID'
        AND COALESCE(PaymentMethod, '') != 'PASS'
        AND NOT STARTS_WITH(COALESCE(InvoiceNumber, ''), 'CO-')
      GROUP BY dateKey, invoiceNumber, bookingId
      ORDER BY dateKey ASC, invoiceNumber ASC
      LIMIT 500
    `,
    input,
    {
      queryName: "ai_revenue_attribution_paid_invoices",
      ttlMs: 30_000,
    },
  );
}

async function estimatePackageRecovery(input: {
  action: AiRevenueAction;
  throughDate: string;
  authorizationHeader?: string;
}) {
  const startingRemaining = parseNumber(input.action.packageInfo.remainingUnits);
  if (startingRemaining <= 0 || !input.action.customer.customerName) {
    return 0;
  }

  const report = await getPackagePortalCustomerHoldings({
    clinicId: input.action.clinicId,
    customerName: input.action.customer.customerName,
    customerPhone: input.action.customer.phoneNumber ?? undefined,
    memberId: input.action.customer.memberId ?? undefined,
    throughDate: input.throughDate,
    authorizationHeader: input.authorizationHeader,
  });
  const packageId = normalizeTextKey(input.action.packageInfo.packageId);
  const packageName = normalizeTextKey(input.action.packageInfo.packageName);
  const serviceName = normalizeTextKey(input.action.service.serviceName);
  const matchedHoldings = report.holdings.filter((holding) => {
    if (packageId && normalizeTextKey(holding.packageId) === packageId) {
      return true;
    }
    if (packageName && normalizeTextKey(holding.packageName) === packageName) {
      return true;
    }
    if (serviceName && Array.isArray(holding.serviceNames)) {
      return holding.serviceNames.some((name) => normalizeTextKey(name) === serviceName);
    }
    return false;
  });
  const currentRemaining = (matchedHoldings.length ? matchedHoldings : report.holdings).reduce(
    (sum, holding) => sum + parseNumber(holding.remainingUnits),
    0,
  );

  return Math.max(0, startingRemaining - currentRemaining);
}

async function saveRevenueAttribution(input: {
  clinicId: string;
  actionId: string;
  patch: Partial<AiRevenueRevenueInfo>;
  user?: SessionUser;
  actorType?: "staff" | "system";
  auditDescription: string;
}) {
  const timestamp = nowIso();
  const actionWithRevenue = await repository.updateRevenue({
    clinicId: input.clinicId,
    actionId: input.actionId,
    patch: {
      ...input.patch,
      revenueAt: input.patch.revenueAt ?? timestamp,
    },
  });
  const nextAction = await repository.updateActionStatus({
    clinicId: input.clinicId,
    actionId: input.actionId,
    status: "revenue_attributed",
    updatedBy: actorFromUser(input.user),
  });

  await repository.saveAppointmentOutcome({
    clinicId: input.clinicId,
    actionId: input.actionId,
    memberId: nextAction.customer.memberId ?? null,
    bookingId: nextAction.appointment.bookingId ?? null,
    appointmentDateTime: nextAction.appointment.appointmentDateTime ?? null,
    bookingStatus: nextAction.appointment.bookingStatus ?? null,
    checkedInAt: nextAction.appointment.cameAt ?? null,
    checkoutAt: nextAction.appointment.completedAt ?? null,
    cancelledAt: nextAction.appointment.cancelledAt ?? null,
    noShowAt: nextAction.appointment.noShowAt ?? null,
    orderId: nextAction.revenue.orderId ?? null,
    revenueAmount: nextAction.revenue.actualRevenue ?? null,
    packageSessionsRecovered: nextAction.revenue.packageSessionsRecovered ?? null,
  });
  await repository.createAuditLog({
    clinicId: input.clinicId,
    actionId: input.actionId,
    actorType: input.actorType ?? "staff",
    actorId: input.actorType === "system" ? "ai_revenue_attribution" : input.user?.userId ?? input.user?.uid ?? null,
    action: "revenue_attributed",
    description: input.auditDescription,
    afterValue: actionWithRevenue.revenue,
  });

  return nextAction;
}

export async function recordManualAiRevenue(input: {
  clinicId: string;
  actionId: string;
  patch: Partial<AiRevenueRevenueInfo>;
  user?: SessionUser;
}) {
  const actualRevenue = Math.max(0, parseNumber(input.patch.actualRevenue));
  const influencedRevenue = Math.max(0, parseNumber(input.patch.influencedRevenue));
  const packageSessionsRecovered = Math.max(0, parseNumber(input.patch.packageSessionsRecovered));
  const requestedAttributionType = input.patch.attributionType;
  const attributionType =
    packageSessionsRecovered > 0 && actualRevenue === 0 && influencedRevenue === 0 && (!requestedAttributionType || requestedAttributionType === "manual")
      ? "package_recovery"
      : requestedAttributionType ??
    (actualRevenue > 0 ? "manual" : packageSessionsRecovered > 0 ? "package_recovery" : "manual");

  return saveRevenueAttribution({
    clinicId: input.clinicId,
    actionId: input.actionId,
    user: input.user,
    auditDescription: "Staff manually recorded AI Revenue attribution.",
    patch: {
      actualRevenue,
      influencedRevenue,
      packageSessionsRecovered,
      orderId: input.patch.orderId ?? null,
      invoiceNumber: input.patch.invoiceNumber ?? null,
      attributionType,
      revenueAt: input.patch.revenueAt,
      revenueNote: input.patch.revenueNote ?? null,
    },
  });
}

export async function syncAiRevenueAttribution(input: {
  clinicId: string;
  actionId: string;
  clinicCode?: string | null;
  attributionWindowDays?: number;
  authorizationHeader?: string;
  user?: SessionUser;
}) {
  const action = await repository.getAction(input.clinicId, input.actionId);
  const clinicCode = cleanText(input.clinicCode) || cleanText(action.clinicCode);
  if (!clinicCode) {
    throw new HttpError(400, "Clinic code is required before syncing AI Revenue attribution.");
  }

  const windowDays = Math.min(60, Math.max(1, Math.round(input.attributionWindowDays ?? 14)));
  const fromDate = attributionStartDate(action);
  const toDate = addDays(fromDate, windowDays);
  const rows = await fetchPaidInvoices({ clinicCode, fromDate, toDate });
  const exactRow = rows.find((row) => sameBooking(action, row) || rowReferencesAction(action, row));
  if (exactRow) {
    return saveRevenueAttribution({
      clinicId: input.clinicId,
      actionId: input.actionId,
      user: input.user,
      actorType: "system",
      auditDescription: "AI Revenue attribution synced from exact booking/order/payment evidence.",
      patch: {
        actualRevenue: moneyAmount(exactRow),
        influencedRevenue: 0,
        packageSessionsRecovered: action.revenue.packageSessionsRecovered ?? 0,
        orderId: exactRow.invoiceNumber,
        invoiceNumber: exactRow.invoiceNumber,
        attributionType: "exact_booking",
        revenueNote: buildRevenueNote({ attributionType: "exact_booking", row: exactRow }),
      },
    });
  }

  const customerRow = rows.find((row) => sameCustomer(action, row));
  if (customerRow) {
    return saveRevenueAttribution({
      clinicId: input.clinicId,
      actionId: input.actionId,
      user: input.user,
      actorType: "system",
      auditDescription: "AI Revenue attribution synced from same-customer payment window.",
      patch: {
        actualRevenue: 0,
        influencedRevenue: moneyAmount(customerRow),
        packageSessionsRecovered: action.revenue.packageSessionsRecovered ?? 0,
        orderId: customerRow.invoiceNumber,
        invoiceNumber: customerRow.invoiceNumber,
        attributionType: "same_customer_window",
        revenueNote: buildRevenueNote({ attributionType: "same_customer_window", row: customerRow }),
      },
    });
  }

  const recoveredSessions = await estimatePackageRecovery({
    action,
    throughDate: toDate,
    authorizationHeader: input.authorizationHeader,
  });
  if (recoveredSessions > 0) {
    return saveRevenueAttribution({
      clinicId: input.clinicId,
      actionId: input.actionId,
      user: input.user,
      actorType: "system",
      auditDescription: "AI Revenue attribution synced from package/session recovery evidence.",
      patch: {
        actualRevenue: 0,
        influencedRevenue: 0,
        packageSessionsRecovered: recoveredSessions,
        orderId: action.revenue.orderId ?? null,
        invoiceNumber: action.revenue.invoiceNumber ?? null,
        attributionType: "package_recovery",
        revenueNote: buildRevenueNote({
          attributionType: "package_recovery",
          packageSessionsRecovered: recoveredSessions,
        }),
      },
    });
  }

  throw new HttpError(404, `No paid invoice or package recovery was found within ${windowDays} day(s) after the AI Revenue touch.`);
}
