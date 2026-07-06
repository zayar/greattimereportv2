import { createHash } from "node:crypto";
import { env } from "../../config/env.js";
import type {
  AiRevenueAction,
  AiRevenueActionType,
  AiRevenueCustomer,
  AiRevenueEvidenceItem,
  AiRevenuePackageInfo,
  AiRevenuePriority,
  AiRevenueServiceInfo,
  AiRevenueServiceUsageSnapshot,
} from "../../types/ai-revenue-agent.js";
import { calculateCustomerRiskSignals } from "../ai/customer-risk.service.js";
import { getCustomerPortalList, getCustomerPortalPackages } from "../reports/customer-portal.service.js";
import { getPackagePortalReport } from "../reports/package-portal.service.js";
import { getTodayAppointmentsForClinic } from "../telegram/report.service.js";
import { fetchApicoreBookingDetails, type ApicoreBookingDetailsRow } from "../apicore.service.js";
import {
  buildApicoreBookingDetailsDateRange,
  isApicoreBookingWallClockDateInRange,
} from "../apicore-booking-details-range.js";
import {
  buildOpportunityKey,
  createAuditLog,
  isOpportunitySuppressed,
  listActiveCustomerSuppressions,
  listActions,
  upsertAction,
} from "./ai-revenue-agent.repository.js";

type GenerateInput = {
  clinicId: string;
  clinicCode: string;
  dateKey: string;
  forceRefresh?: boolean;
  authorizationHeader?: string;
};

type Candidate = {
  sourceRefId: string;
  actionType: AiRevenueActionType;
  basePriorityScore: number;
  title: string;
  summary: string;
  reason: string;
  evidence: AiRevenueEvidenceItem[];
  recommendedAction: string;
  customer: AiRevenueCustomer;
  service?: AiRevenueServiceInfo;
  serviceUsage?: AiRevenueServiceUsageSnapshot[];
  packageInfo?: AiRevenuePackageInfo;
  appointment?: AiRevenueAction["appointment"];
  source: AiRevenueAction["source"];
};

type PackageFollowUpRow = {
  id: string;
  packageId: string;
  customerName: string;
  customerPhone: string;
  memberId: string;
  packageName: string;
  serviceNames: string[];
  purchasedUnits: number;
  usedUnits: number;
  remainingUnits: number;
  lastVisitDate: string | null;
  daysSinceLastVisit?: number | null;
  daysSinceActivity: number;
  needsFollowUp: boolean;
  therapist?: string | null;
  latestTherapist?: string | null;
  sourcePriority?: number;
};

const ACTIVE_APPOINTMENT_STATUSES = new Set(["BOOKED", "REQUEST", "CHECKIN", "CHECKED_IN"]);
const PENDING_REMINDER_APPOINTMENT_STATUSES = new Set(["BOOKED", "REQUEST"]);
const COMPLETED_APPOINTMENT_STATUSES = new Set(["CHECKOUT", "CHECKED_OUT", "COMPLETED"]);
const CANCELLED_APPOINTMENT_STATUSES = new Set(["MEMBER_CANCEL", "MERCHANT_CANCEL", "CANCEL", "CANCELLED"]);
const NO_SHOW_APPOINTMENT_STATUSES = new Set(["NO_SHOW", "NOSHOW"]);
const APPOINTMENT_HISTORY_PAGE_SIZE = 200;
const APPOINTMENT_HISTORY_MAX_ROWS = 1000;
const CUSTOMER_PACKAGE_LOOKUP_CONCURRENCY = 6;
const CUSTOMER_FOCUS_LIMIT = 100;

function nowIso() {
  return new Date().toISOString();
}

function hashId(value: string) {
  return createHash("sha1").update(value).digest("hex").slice(0, 24);
}

function buildActionId(dedupeKey: string) {
  return `air_${hashId(dedupeKey)}`;
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetweenDateKeys(laterDateKey: string, earlierDateKey: string | null | undefined) {
  if (!earlierDateKey) {
    return 999;
  }

  const later = new Date(`${laterDateKey.slice(0, 10)}T00:00:00.000Z`);
  const earlier = new Date(`${earlierDateKey.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(later.getTime()) || Number.isNaN(earlier.getTime())) {
    return 999;
  }

  return Math.max(0, Math.round((later.getTime() - earlier.getTime()) / 86_400_000));
}

function cleanText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizePhone(value: unknown) {
  return cleanText(value).replace(/\D/g, "");
}

function maskPhone(value: unknown) {
  const digits = normalizePhone(value);
  if (!digits) {
    return null;
  }
  return `***${digits.slice(-4)}`;
}

function normalizeNameKey(value: unknown) {
  return cleanText(value).replace(/\s+/g, " ").toLowerCase();
}

function customerKey(input: { memberId?: unknown; phone?: unknown; customerName?: unknown }) {
  const memberId = cleanText(input.memberId);
  if (memberId) {
    return `member:${memberId}`;
  }

  const phone = normalizePhone(input.phone);
  if (phone) {
    return `phone:${hashId(phone)}`;
  }

  const name = normalizeNameKey(input.customerName);
  return name && !/^unknown(?: customer)?$/.test(name) ? `name:${name}` : "";
}

function hasUsableIdentity(customer: AiRevenueCustomer) {
  return Boolean(
    cleanText(customer.memberId) ||
      normalizePhone(customer.phoneNumber) ||
      (cleanText(customer.customerName) && !/^unknown(?: customer)?$/i.test(cleanText(customer.customerName))),
  );
}

function normalizeStatus(value: unknown) {
  return cleanText(value).toUpperCase().replace(/[\s-]+/g, "_");
}

function isActiveAppointment(row: ApicoreBookingDetailsRow) {
  return ACTIVE_APPOINTMENT_STATUSES.has(normalizeStatus(row.status));
}

function isPendingReminderAppointment(row: ApicoreBookingDetailsRow) {
  const status = normalizeStatus(row.status);
  return !status || PENDING_REMINDER_APPOINTMENT_STATUSES.has(status);
}

function isCompletedAppointment(row: ApicoreBookingDetailsRow) {
  return COMPLETED_APPOINTMENT_STATUSES.has(normalizeStatus(row.status));
}

function isCancelledAppointment(row: ApicoreBookingDetailsRow) {
  return CANCELLED_APPOINTMENT_STATUSES.has(normalizeStatus(row.status));
}

function isNoShowAppointment(row: ApicoreBookingDetailsRow) {
  return NO_SHOW_APPOINTMENT_STATUSES.has(normalizeStatus(row.status));
}

function priorityFromScore(score: number): AiRevenuePriority {
  if (score >= 75) {
    return "high";
  }
  if (score >= 45) {
    return "medium";
  }
  return "low";
}

function moneyLabel(value: number | null | undefined) {
  if (value == null || value <= 0) {
    return null;
  }
  return `${Math.round(value).toLocaleString("en-US")} MMK`;
}

function buildAppointmentCustomer(row: ApicoreBookingDetailsRow): AiRevenueCustomer {
  const name = cleanText(row.MemberName, "Customer");
  const phone = cleanText(row.MemberPhoneNumber);
  return {
    customerKey: customerKey({ customerName: name, phone }),
    memberId: null,
    customerName: name,
    phoneNumber: phone || null,
    phoneMasked: maskPhone(phone),
  };
}

function appointmentEvidence(row: ApicoreBookingDetailsRow): AiRevenueEvidenceItem[] {
  return [
    { label: "Booking ID", value: row.bookingid },
    { label: "Appointment time", value: row.FromTime },
    { label: "Service", value: cleanText(row.ServiceName, "Unknown service") },
    { label: "Practitioner", value: cleanText(row.PractitionerName, "Unassigned") },
    { label: "Booking status", value: cleanText(row.status, "Unknown") },
  ];
}

function isSameCustomer(left: AiRevenueCustomer, right: AiRevenueCustomer) {
  if (left.customerKey && right.customerKey && left.customerKey === right.customerKey) {
    return true;
  }
  if (left.memberId && right.memberId && left.memberId === right.memberId) {
    return true;
  }
  const leftPhone = normalizePhone(left.phoneNumber);
  const rightPhone = normalizePhone(right.phoneNumber);
  return Boolean(leftPhone && rightPhone && leftPhone === rightPhone);
}

function packageRowCustomer(row: Pick<PackageFollowUpRow, "memberId" | "customerPhone" | "customerName">): AiRevenueCustomer {
  return {
    customerKey: customerKey({ memberId: row.memberId, phone: row.customerPhone, customerName: row.customerName }),
    memberId: cleanText(row.memberId) || null,
    customerName: row.customerName,
    phoneNumber: cleanText(row.customerPhone) || null,
    phoneMasked: maskPhone(row.customerPhone),
  };
}

function serviceNameMatches(left: unknown, right: unknown) {
  const leftName = normalizeNameKey(left);
  const rightName = normalizeNameKey(right);
  return Boolean(leftName && rightName && (leftName === rightName || leftName.includes(rightName) || rightName.includes(leftName)));
}

function packageServiceLabel(row: Pick<PackageFollowUpRow, "serviceNames" | "packageName">) {
  return row.serviceNames.filter(Boolean).join(", ") || row.packageName || "Unknown service";
}

function packageBalanceText(row: Pick<PackageFollowUpRow, "remainingUnits" | "purchasedUnits" | "serviceNames" | "packageName">) {
  return `${row.remainingUnits}/${row.purchasedUnits} ${packageServiceLabel(row)}`;
}

function packageRowTherapist(row?: PackageFollowUpRow | null) {
  return cleanText(row?.latestTherapist) || cleanText(row?.therapist) || null;
}

function serviceUsageStatus(remaining: number | null | undefined): AiRevenueServiceUsageSnapshot["status"] {
  if (remaining == null) {
    return "unknown";
  }
  if (remaining <= 0) {
    return "completed";
  }
  if (remaining <= 2) {
    return "low_remaining";
  }
  return "active";
}

function serviceUsageFromPackageRow(
  row: PackageFollowUpRow,
  isFocusService: boolean,
): AiRevenueServiceUsageSnapshot {
  const serviceName = packageServiceLabel(row);
  return {
    serviceId: null,
    serviceName,
    packageId: row.packageId,
    packageName: row.packageName,
    packageTotal: row.purchasedUnits,
    used: row.usedUnits,
    remaining: row.remainingUnits,
    latestUsageDate: row.lastVisitDate,
    status: serviceUsageStatus(row.remainingUnits),
    isFocusService,
    note: `${row.remainingUnits}/${row.purchasedUnits} session(s) remaining`,
  };
}

function buildServiceUsageSnapshots(input: {
  focusServiceName: string;
  focusRows: PackageFollowUpRow[];
  otherRows: PackageFollowUpRow[];
  fallbackRemainingSessions?: number | null;
}) {
  const focusSnapshots = input.focusRows.map((row) => serviceUsageFromPackageRow(row, true));
  const otherSnapshots = input.otherRows.map((row) => serviceUsageFromPackageRow(row, false));
  if (focusSnapshots.length > 0 || otherSnapshots.length > 0) {
    return [...focusSnapshots, ...otherSnapshots].slice(0, 8);
  }

  const fallbackRemaining = input.fallbackRemainingSessions ?? null;
  if (fallbackRemaining != null && fallbackRemaining > 0) {
    return [
      {
        serviceName: input.focusServiceName || "Package balance",
        packageId: null,
        packageName: null,
        packageTotal: null,
        used: null,
        remaining: fallbackRemaining,
        latestUsageDate: null,
        status: serviceUsageStatus(fallbackRemaining),
        isFocusService: true,
        note: "Remaining sessions from customer profile",
      },
    ] satisfies AiRevenueServiceUsageSnapshot[];
  }

  return [];
}

function firstSentence(value: string, maxLength: number) {
  const sentence = cleanText(value).split(/(?<=[.!?])\s+/)[0] ?? "";
  if (sentence.length <= maxLength) {
    return sentence;
  }
  return `${sentence.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function isOpenWorkflowAction(action: AiRevenueAction) {
  const visibilityState = action.visibilityState ?? "active";
  const workflowState = action.workflowState ?? "new";
  return (
    (visibilityState === "active" || visibilityState === "scheduled") &&
    workflowState !== "completed" &&
    workflowState !== "closed" &&
    !action.resolution
  );
}

function isCompletedOrSuppressedWorkflowAction(action: AiRevenueAction) {
  return (
    Boolean(action.resolution) ||
    action.visibilityState === "completed" ||
    action.visibilityState === "suppressed" ||
    action.workflowState === "completed" ||
    action.workflowState === "closed" ||
    action.status === "completed" ||
    action.status === "closed" ||
    action.status === "skipped" ||
    action.status === "not_interested"
  );
}

function buildCustomerPackageContext(input: {
  customer: AiRevenueCustomer;
  serviceName: string;
  packageRows: PackageFollowUpRow[];
}) {
  const rows = input.packageRows
    .filter((row) => row.remainingUnits > 0)
    .filter((row) => isSameCustomer(input.customer, packageRowCustomer(row)));
  const sameTreatmentRows = rows.filter((row) => row.serviceNames.some((service) => serviceNameMatches(service, input.serviceName)));
  const sameTreatmentRemaining = sameTreatmentRows.reduce((sum, row) => sum + row.remainingUnits, 0);
  const otherRows = rows.filter((row) => !sameTreatmentRows.some((sameRow) => sameRow.id === row.id));

  return {
    rows,
    sameTreatmentRows,
    sameTreatmentRemaining,
    otherRows,
    totalRemaining: rows.reduce((sum, row) => sum + row.remainingUnits, 0),
  };
}

function packageContextKey(row: Pick<PackageFollowUpRow, "memberId" | "customerPhone" | "customerName" | "serviceNames" | "packageName">) {
  const customer = packageRowCustomer(row);
  const serviceKey = normalizeNameKey(row.serviceNames.join("|") || row.packageName);
  return `${customer.customerKey || customer.memberId || normalizePhone(customer.phoneNumber) || normalizeNameKey(customer.customerName)}::${serviceKey}`;
}

function mergePackageRows(rows: PackageFollowUpRow[]) {
  const byKey = new Map<string, PackageFollowUpRow>();

  for (const row of rows) {
    const key = packageContextKey(row);
    const current = byKey.get(key);
    const rowPriority = row.sourcePriority ?? 1;
    const currentPriority = current?.sourcePriority ?? 1;
    if (
      !current ||
      rowPriority > currentPriority ||
      (rowPriority === currentPriority && row.remainingUnits > current.remainingUnits) ||
      (rowPriority === currentPriority &&
        row.remainingUnits === current.remainingUnits &&
        (row.lastVisitDate ?? "") > (current.lastVisitDate ?? ""))
    ) {
      byKey.set(key, row);
    }
  }

  return [...byKey.values()];
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function fetchCustomerPackageFallbackRows(input: {
  clinicCode: string;
  dateKey: string;
  rows: Array<{
    customerName: string;
    phoneNumber: string;
    memberId: string;
    rebookingStatus: string;
    remainingSessions: number;
  }>;
}) {
  const candidates = input.rows.filter((row) => {
    if (row.rebookingStatus !== "overdue" && row.rebookingStatus !== "dueSoon") {
      return false;
    }

    const customer: AiRevenueCustomer = {
      customerKey: customerKey({ memberId: row.memberId, phone: row.phoneNumber, customerName: row.customerName }),
      memberId: cleanText(row.memberId) || null,
      customerName: row.customerName,
      phoneNumber: cleanText(row.phoneNumber) || null,
      phoneMasked: maskPhone(row.phoneNumber),
    };

    return row.remainingSessions > 0 && hasUsableIdentity(customer);
  });

  const nestedRows = await mapWithConcurrency(candidates, CUSTOMER_PACKAGE_LOOKUP_CONCURRENCY, async (row) => {
    try {
      const result = await getCustomerPortalPackages({
        clinicCode: input.clinicCode,
        fromDate: addDays(input.dateKey, -730),
        toDate: input.dateKey,
        customerName: row.customerName,
        customerPhone: row.phoneNumber,
        memberId: row.memberId,
      });

      return result.packages
        .filter((entry) => entry.remainingCount > 0)
        .map<PackageFollowUpRow>((entry) => ({
          id: `customer_package:${customerKey({ memberId: row.memberId, phone: row.phoneNumber, customerName: row.customerName })}:${entry.id}`,
          packageId: entry.id,
          customerName: row.customerName,
          customerPhone: row.phoneNumber,
          memberId: row.memberId,
          packageName: entry.packageName || entry.serviceName || "Package balance",
          serviceNames: entry.serviceName ? [entry.serviceName] : [],
          purchasedUnits: entry.packageTotal,
          usedUnits: entry.usedCount,
          remainingUnits: entry.remainingCount,
          lastVisitDate: entry.latestUsageDate,
          daysSinceLastVisit: daysBetweenDateKeys(input.dateKey, entry.latestUsageDate),
          daysSinceActivity: daysBetweenDateKeys(input.dateKey, entry.latestUsageDate),
          needsFollowUp: true,
          latestTherapist: entry.latestTherapist,
          sourcePriority: 2,
        }));
    } catch {
      return [];
    }
  });

  return nestedRows.flat();
}

async function fetchAppointmentHistory(input: {
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

  while (skip < totalCount && rows.length < APPOINTMENT_HISTORY_MAX_ROWS) {
    const result = await fetchApicoreBookingDetails({
      clinicCode: input.clinicCode,
      startDate: range.startIso,
      endDate: range.endIso,
      skip,
      take: APPOINTMENT_HISTORY_PAGE_SIZE,
      authorizationHeader: input.authorizationHeader,
      readOnly: true,
    });

    totalCount = result.totalCount;
    if (result.data.length === 0) {
      break;
    }

    rows.push(
      ...result.data.filter((row) =>
        isApicoreBookingWallClockDateInRange(row.FromTime, input.fromDate, input.toDate),
      ),
    );
    skip += result.data.length;
  }

  return rows;
}

function buildHighRiskAppointmentCustomerSet(rows: ApicoreBookingDetailsRow[]) {
  const riskyCustomers = new Set<string>();

  rows
    .filter((row) => isNoShowAppointment(row) || isCancelledAppointment(row))
    .map(buildAppointmentCustomer)
    .filter(hasUsableIdentity)
    .forEach((customer) => {
      if (customer.customerKey) {
        riskyCustomers.add(customer.customerKey);
      }
    });

  return riskyCustomers;
}

function baseAction(input: GenerateInput, candidate: Candidate, score: number): AiRevenueAction {
  const timestamp = nowIso();
  const service = candidate.service ?? {};
  const packageInfo = candidate.packageInfo ?? {};
  const opportunityKey = buildOpportunityKey({
    clinicId: input.clinicId,
    actionType: candidate.actionType,
    customer: candidate.customer,
    service,
    packageInfo,
  });
  const dedupeKey = [
    input.clinicId,
    input.dateKey,
    candidate.actionType,
    candidate.customer.customerKey || candidate.customer.memberId || candidate.customer.phoneNumber || candidate.customer.customerName,
    candidate.sourceRefId,
  ].join("|");

  return {
    id: buildActionId(dedupeKey),
    clinicId: input.clinicId,
    clinicCode: input.clinicCode,
    dateKey: input.dateKey,
    opportunityKey,
    originalDateKey: input.dateKey,
    dueDateKey: input.dateKey,
    source: candidate.source,
    sourceRefId: candidate.sourceRefId,
    actionType: candidate.actionType,
    workflowState: "new",
    visibilityState: "active",
    attemptCount: 0,
    priority: priorityFromScore(score),
    priorityScore: score,
    title: candidate.title,
    summary: candidate.summary,
    reason: candidate.reason,
    displayReason: firstSentence(candidate.reason, 160),
    evidence: candidate.evidence,
    recommendedAction: candidate.recommendedAction,
    aiSuggestion: firstSentence(candidate.recommendedAction, 160),
    customer: candidate.customer,
    service,
    serviceUsage: candidate.serviceUsage ?? [],
    packageInfo,
    appointment: candidate.appointment ?? {},
    message: {},
    revenue: {
      actualRevenue: 0,
      influencedRevenue: 0,
      packageSessionsRecovered: 0,
      attributionType: "unknown",
    },
    followUp: {
      status: "open",
      dueDate: input.dateKey,
      nextFollowUpDate: input.dateKey,
      lastAttemptId: null,
      lastContactedAt: null,
      lastChannel: null,
      lastResult: null,
      lastNote: null,
      lastHandledBy: null,
      attemptCount: 0,
      completedAt: null,
      completedBy: null,
      suppressedAt: null,
      suppressionId: null,
      outcome: {
        appointmentBookingId: null,
        appointmentBookedAt: null,
        appointmentDateTime: null,
        customerCameAt: null,
        treatmentCompletedAt: null,
        packageSessionUsedAt: null,
        packageSessionsRecovered: 0,
        repurchaseInvoiceNumber: null,
        repurchaseRevenue: 0,
        revenueAttributedAt: null,
        attributionType: "unknown",
      },
    },
    status: "new",
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: {
      userId: "ai_revenue_agent",
      email: null,
      name: "AI Revenue Agent",
    },
    lastStatusAt: null,
    lastStatusBy: null,
  };
}

function mergeOptionalObject<T extends object>(generated: T, existing: T) {
  const generatedRecord = generated as Record<string, unknown>;
  const existingRecord = existing as Record<string, unknown>;
  return Object.fromEntries(
    Array.from(new Set([...Object.keys(generatedRecord), ...Object.keys(existingRecord)])).map((key) => {
      const existingValue = existingRecord[key];
      const generatedValue = generatedRecord[key];
      return [key, existingValue == null || existingValue === "" ? generatedValue : existingValue];
    }),
  ) as T;
}

function mergeGeneratedSourceObject<T extends object>(existing: T, generated: T) {
  const generatedRecord = generated as Record<string, unknown>;
  const existingRecord = existing as Record<string, unknown>;
  return Object.fromEntries(
    Array.from(new Set([...Object.keys(existingRecord), ...Object.keys(generatedRecord)])).map((key) => {
      const existingValue = existingRecord[key];
      const generatedValue = generatedRecord[key];
      return [key, generatedValue == null || generatedValue === "" ? existingValue : generatedValue];
    }),
  ) as T;
}

function mergeGeneratedActionContext(existing: AiRevenueAction, generated: AiRevenueAction): AiRevenueAction {
  return {
    ...existing,
    clinicCode: generated.clinicCode || existing.clinicCode,
    source: generated.source,
    sourceRefId: generated.sourceRefId,
    actionType: generated.actionType,
    priority: generated.priority,
    priorityScore: generated.priorityScore,
    title: generated.title,
    summary: generated.summary,
    reason: generated.reason,
    displayReason: generated.displayReason ?? existing.displayReason ?? null,
    evidence: generated.evidence,
    recommendedAction: generated.recommendedAction,
    aiSuggestion: generated.aiSuggestion ?? existing.aiSuggestion ?? null,
    opportunityKey: existing.opportunityKey ?? generated.opportunityKey ?? buildOpportunityKey(generated),
    originalDateKey: existing.originalDateKey ?? generated.originalDateKey ?? existing.dateKey,
    customer: {
      ...existing.customer,
      ...generated.customer,
    },
    service: mergeGeneratedSourceObject(existing.service, generated.service),
    serviceUsage: generated.serviceUsage ?? existing.serviceUsage ?? [],
    packageInfo: {
      ...existing.packageInfo,
      ...generated.packageInfo,
    },
    appointment: mergeOptionalObject(generated.appointment, existing.appointment),
    updatedAt: nowIso(),
  };
}

function didGeneratedContextChange(existing: AiRevenueAction, generated: AiRevenueAction) {
  const currentContext = {
    priority: existing.priority,
    priorityScore: existing.priorityScore,
    title: existing.title,
    summary: existing.summary,
    reason: existing.reason,
    evidence: existing.evidence,
    recommendedAction: existing.recommendedAction,
    displayReason: existing.displayReason,
    aiSuggestion: existing.aiSuggestion,
    customer: existing.customer,
    service: existing.service,
    serviceUsage: existing.serviceUsage ?? [],
    packageInfo: existing.packageInfo,
    appointment: existing.appointment,
  };
  const nextContext = {
    priority: generated.priority,
    priorityScore: generated.priorityScore,
    title: generated.title,
    summary: generated.summary,
    reason: generated.reason,
    evidence: generated.evidence,
    recommendedAction: generated.recommendedAction,
    displayReason: generated.displayReason,
    aiSuggestion: generated.aiSuggestion,
    customer: generated.customer,
    service: mergeGeneratedSourceObject(existing.service, generated.service),
    serviceUsage: generated.serviceUsage ?? [],
    packageInfo: {
      ...existing.packageInfo,
      ...generated.packageInfo,
    },
    appointment: mergeOptionalObject(generated.appointment, existing.appointment),
  };

  return JSON.stringify(currentContext) !== JSON.stringify(nextContext);
}

function applyPriorityAdjustments(input: {
  candidate: Candidate;
  existingActions: AiRevenueAction[];
  upcomingCustomers: AiRevenueCustomer[];
}) {
  let score = input.candidate.basePriorityScore;
  const hasPhone = Boolean(normalizePhone(input.candidate.customer.phoneNumber));

  if (!hasPhone) {
    score -= 30;
  }

  const recentlyContacted = input.existingActions.some(
    (action) =>
      isSameCustomer(action.customer, input.candidate.customer) &&
      ["sent", "customer_replied", "appointment_requested", "appointment_created", "appointment_confirmed"].includes(action.status),
  );
  if (recentlyContacted) {
    score -= 40;
  }

  const hasUpcomingAppointment = input.upcomingCustomers.some((customer) => isSameCustomer(customer, input.candidate.customer));
  if (hasUpcomingAppointment && input.candidate.actionType !== "appointment_confirmation_reminder") {
    score -= 80;
  }

  return Math.max(0, Math.min(100, score));
}

function createServiceReminderCandidates(input: {
  rows: Array<{
    customerName: string;
    phoneNumber: string;
    memberId: string;
    lastVisitDate: string | null;
    daysSinceLastVisit: number | null;
    visitCount: number;
    lastService: string;
    primaryTherapist?: string | null;
    averageSpend: number;
    remainingSessions: number;
    rebookingStatus: string;
    healthScore: number;
  }>;
  dateKey: string;
  packageRows: PackageFollowUpRow[];
}) {
  return input.rows.flatMap<Candidate>((row) => {
    if (row.rebookingStatus !== "overdue" && row.rebookingStatus !== "dueSoon") {
      return [];
    }

    const customer: AiRevenueCustomer = {
      customerKey: customerKey({ memberId: row.memberId, phone: row.phoneNumber, customerName: row.customerName }),
      memberId: cleanText(row.memberId) || null,
      customerName: row.customerName,
      phoneNumber: cleanText(row.phoneNumber) || null,
      phoneMasked: maskPhone(row.phoneNumber),
    };
    if (!hasUsableIdentity(customer)) {
      return [];
    }

    const risk = calculateCustomerRiskSignals({
      totalVisits: row.visitCount,
      daysSinceLastVisit: row.daysSinceLastVisit,
      avgVisitGapDays: null,
      remainingSessions: row.remainingSessions,
      recent3MonthVisits: 0,
      previous3MonthVisits: 0,
    });
    const overdue = row.rebookingStatus === "overdue";
    const serviceName = cleanText(row.lastService, "recent service");
    const expectedGap = risk.expectedReturnGapDays ?? null;
    const patternReminderDate =
      row.lastVisitDate && expectedGap != null ? addDays(row.lastVisitDate, expectedGap) : null;
    const packageContext = buildCustomerPackageContext({
      customer,
      serviceName,
      packageRows: input.packageRows,
    });
    const sameTreatmentRows = packageContext.sameTreatmentRows;
    const sameTreatmentRow = sameTreatmentRows[0];
    const serviceUsage = buildServiceUsageSnapshots({
      focusServiceName: serviceName,
      focusRows: sameTreatmentRows,
      otherRows: packageContext.otherRows,
      fallbackRemainingSessions: row.remainingSessions,
    });
    const sameTreatmentPurchased = sameTreatmentRows.reduce((sum, item) => sum + item.purchasedUnits, 0);
    const sameTreatmentUsed = sameTreatmentRows.reduce((sum, item) => sum + item.usedUnits, 0);
    const sameTreatmentLastUsedAt =
      sameTreatmentRows
        .map((item) => item.lastVisitDate)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? sameTreatmentRow?.lastVisitDate ?? null;
    const otherRemainingText = packageContext.otherRows.map(packageBalanceText).join(", ");
    const basePriorityScore = Math.min(
      100,
      (overdue ? 90 : 80) +
        (packageContext.sameTreatmentRemaining > 0 ? 15 : 0) +
        (packageContext.sameTreatmentRemaining === 0 && packageContext.totalRemaining > 0 ? 5 : 0),
    );

    return [
      {
        source: "bigquery",
        sourceRefId: `pattern:${customer.customerKey}:${serviceName}:${row.lastVisitDate ?? "unknown"}`,
        actionType: overdue ? "service_reminder_overdue" : "service_reminder_follow_up",
        basePriorityScore,
        title: overdue ? "Pattern-based service reminder overdue" : "Pattern-based service follow-up",
        summary: `${row.customerName} may be ready to return for ${serviceName}.`,
        reason:
          packageContext.sameTreatmentRemaining > 0
            ? "Customer last visited for this treatment and still has remaining sessions for the same treatment, which makes return likelihood high."
            : overdue
              ? "Customer visit pattern indicates the expected return window is overdue. Exact service interval_day was not available from APICORE."
              : "Customer visit pattern indicates the customer is close to the expected return window. Exact service interval_day was not available from APICORE.",
        recommendedAction: "Review customer history, confirm the service, then prepare a staff-approved follow-up message.",
        evidence: [
          { label: "Reminder type", value: "Pattern-based reminder" },
          { label: "Last service", value: serviceName },
          { label: "Focused treatment", value: serviceName },
          { label: "Focused treatment remaining", value: packageContext.sameTreatmentRemaining },
          ...(sameTreatmentRows.length > 0
            ? [
                { label: "Focused treatment purchased", value: sameTreatmentPurchased },
                { label: "Focused treatment used", value: sameTreatmentUsed },
              ]
            : []),
          ...(sameTreatmentLastUsedAt ? [{ label: "Focused treatment last usage", value: sameTreatmentLastUsedAt }] : []),
          ...(otherRemainingText ? [{ label: "Other remaining services", value: otherRemainingText }] : []),
          ...(packageContext.totalRemaining > 0 ? [{ label: "Total remaining sessions", value: packageContext.totalRemaining }] : []),
          ...(row.lastVisitDate ? [{ label: "Last visit date", value: row.lastVisitDate }] : []),
          ...(patternReminderDate ? [{ label: "Pattern reminder date", value: patternReminderDate }] : []),
          ...(row.daysSinceLastVisit != null ? [{ label: "Days since last visit", value: row.daysSinceLastVisit }] : []),
          ...(expectedGap != null ? [{ label: "Expected return gap", value: `${expectedGap} days` }] : []),
          ...(moneyLabel(row.averageSpend) ? [{ label: "Average spend", value: moneyLabel(row.averageSpend)! }] : []),
        ],
        customer,
        service: {
          serviceName,
          lastVisitDate: row.lastVisitDate,
          lastVisitSinceDays: row.daysSinceLastVisit,
          lastTreatmentTherapist: cleanText(row.primaryTherapist) || packageRowTherapist(sameTreatmentRow) || null,
          preferredTherapist: cleanText(row.primaryTherapist) || null,
          reminderDate: patternReminderDate,
        },
        serviceUsage,
        packageInfo: sameTreatmentRow
          ? {
              packageId: sameTreatmentRow.packageId,
              packageName: sameTreatmentRow.packageName,
              remainingUnits: packageContext.sameTreatmentRemaining,
              purchasedUnits: sameTreatmentPurchased,
              usedUnits: sameTreatmentUsed,
              lastUsedAt: sameTreatmentLastUsedAt,
            }
          : undefined,
      },
    ];
  });
}

function createPackageCandidates(rows: PackageFollowUpRow[]) {
  return rows.flatMap<Candidate>((row) => {
    if (row.remainingUnits <= 0 || (!row.needsFollowUp && row.daysSinceActivity < 21)) {
      return [];
    }

    const customer: AiRevenueCustomer = {
      customerKey: customerKey({ memberId: row.memberId, phone: row.customerPhone, customerName: row.customerName }),
      memberId: cleanText(row.memberId) || null,
      customerName: row.customerName,
      phoneNumber: cleanText(row.customerPhone) || null,
      phoneMasked: maskPhone(row.customerPhone),
    };
    if (!hasUsableIdentity(customer)) {
      return [];
    }
    const serviceName = row.serviceNames[0] ?? row.packageName ?? "Package balance";
    const packageContext = buildCustomerPackageContext({
      customer,
      serviceName,
      packageRows: rows,
    });
    const focusRows = [
      row,
      ...packageContext.sameTreatmentRows.filter((item) => item.id !== row.id),
    ];
    const focusRowIds = new Set(focusRows.map((item) => item.id));
    const otherRows = packageContext.rows.filter((item) => !focusRowIds.has(item.id));
    const serviceUsage = buildServiceUsageSnapshots({
      focusServiceName: serviceName,
      focusRows,
      otherRows,
    });

    return [
      {
        source: "package_portal",
        sourceRefId: row.id,
        actionType: "unused_package_follow_up",
        basePriorityScore: 75,
        title: "Recover unused package balance",
        summary: `${row.customerName} has ${row.remainingUnits} remaining session(s) in ${row.packageName}.`,
        reason: "Customer has prepaid/package service balance remaining and has not used it recently.",
        recommendedAction: "Contact the customer and help book the next remaining package session.",
        evidence: [
          { label: "Package", value: row.packageName },
          { label: "Remaining sessions", value: row.remainingUnits },
          { label: "Purchased sessions", value: row.purchasedUnits },
          { label: "Used sessions", value: row.usedUnits },
          { label: "Service(s)", value: row.serviceNames.join(", ") || "Unknown" },
          ...(row.lastVisitDate ? [{ label: "Last usage date", value: row.lastVisitDate }] : []),
          { label: "Days since activity", value: row.daysSinceActivity },
        ],
        customer,
        service: {
          serviceName,
          lastVisitDate: row.lastVisitDate,
          lastVisitSinceDays: row.daysSinceLastVisit ?? row.daysSinceActivity,
          lastTreatmentTherapist: packageRowTherapist(row),
          preferredTherapist: packageRowTherapist(row),
        },
        serviceUsage,
        packageInfo: {
          packageId: row.packageId,
          packageName: row.packageName,
          remainingUnits: row.remainingUnits,
          purchasedUnits: row.purchasedUnits,
          usedUnits: row.usedUnits,
          lastUsedAt: row.lastVisitDate,
        },
      },
    ];
  });
}

function createAppointmentCandidates(params: {
  todayRows: ApicoreBookingDetailsRow[];
  tomorrowRows: ApicoreBookingDetailsRow[];
  dateKey: string;
  highRiskCustomers: Set<string>;
}) {
  const todayReminderRows = params.todayRows.filter((row) => isPendingReminderAppointment(row) && !isCompletedAppointment(row));
  const tomorrowReminderRows = params.tomorrowRows.filter(isActiveAppointment);
  const recoveryRows = params.todayRows.filter((row) => isNoShowAppointment(row) || isCancelledAppointment(row));

  const reminderCandidates = [...todayReminderRows, ...tomorrowReminderRows].flatMap<Candidate>((row) => {
    const customer = buildAppointmentCustomer(row);
    if (!hasUsableIdentity(customer)) {
      return [];
    }

    const isTomorrow = row.FromTime.slice(0, 10) > params.dateKey;
    const highRisk = customer.customerKey ? params.highRiskCustomers.has(customer.customerKey) : false;

    return [
      {
        source: "appointment_report",
        sourceRefId: row.bookingid,
        actionType: "appointment_confirmation_reminder",
        basePriorityScore: highRisk ? 80 : 70,
        title: isTomorrow ? "Tomorrow appointment reminder" : "Same-day appointment reminder",
        summary: `${customer.customerName ?? "Customer"} has an upcoming ${cleanText(row.ServiceName, "service")} appointment.`,
        reason: highRisk
          ? "Customer has prior no-show/cancel pattern and should receive a human-approved appointment reminder."
          : isTomorrow
            ? "Customer has an appointment tomorrow and should receive a confirmation reminder."
            : "Customer has an appointment today and has not checked in yet.",
        recommendedAction: "Confirm appointment time with the customer and record reply or staff follow-up.",
        evidence: [
          ...appointmentEvidence(row),
          ...(highRisk ? [{ label: "Risk signal", value: "Prior no-show/cancel pattern" }] : []),
        ],
        customer,
        service: {
          serviceName: cleanText(row.ServiceName, "Unknown service"),
          lastTreatmentTherapist: cleanText(row.PractitionerName) || null,
          preferredTherapist: cleanText(row.PractitionerName) || null,
        },
        appointment: {
          bookingId: row.bookingid,
          appointmentDateTime: row.FromTime,
          bookingStatus: row.status,
        },
      },
    ];
  });

  const recoveryCandidates = recoveryRows.flatMap<Candidate>((row) => {
    const customer = buildAppointmentCustomer(row);
    if (!hasUsableIdentity(customer)) {
      return [];
    }

    const noShow = isNoShowAppointment(row);
    return [
      {
        source: "appointment_report",
        sourceRefId: row.bookingid,
        actionType: noShow ? "no_show_recovery" : "cancelled_appointment_recovery",
        basePriorityScore: noShow ? 65 : 60,
        title: noShow ? "No-show recovery" : "Cancelled appointment recovery",
        summary: `${customer.customerName ?? "Customer"} ${noShow ? "missed" : "cancelled"} an appointment for ${cleanText(row.ServiceName, "service")}.`,
        reason: noShow
          ? "Appointment status is NO_SHOW and no same-day AI Revenue recovery action exists yet."
          : "Appointment was cancelled and customer should be helped to reschedule if no future appointment exists.",
        recommendedAction: "Ask whether the customer wants help rescheduling at a convenient time.",
        evidence: appointmentEvidence(row),
        customer,
        service: {
          serviceName: cleanText(row.ServiceName, "Unknown service"),
          lastVisitDate: params.dateKey,
          lastVisitSinceDays: 0,
          lastTreatmentTherapist: cleanText(row.PractitionerName) || null,
          preferredTherapist: cleanText(row.PractitionerName) || null,
        },
        appointment: {
          bookingId: row.bookingid,
          appointmentDateTime: row.FromTime,
          bookingStatus: row.status,
          noShowAt: noShow ? params.dateKey : null,
          cancelledAt: noShow ? null : params.dateKey,
        },
      },
    ];
  });

  return [...reminderCandidates, ...recoveryCandidates];
}

function createInactiveVipCandidates(rows: Array<{
  customerName: string;
  phoneNumber: string;
  memberId: string;
  lifetimeSpend: number;
  averageSpend: number;
  visitCount: number;
  lastVisitDate: string | null;
  daysSinceLastVisit: number | null;
  lastService: string;
  primaryTherapist: string;
  remainingSessions: number;
  healthScore: number;
}>) {
  return rows.flatMap<Candidate>((row) => {
    if ((row.daysSinceLastVisit ?? 0) < 60 || row.lifetimeSpend < 1_000_000) {
      return [];
    }

    const customer: AiRevenueCustomer = {
      customerKey: customerKey({ memberId: row.memberId, phone: row.phoneNumber, customerName: row.customerName }),
      memberId: cleanText(row.memberId) || null,
      customerName: row.customerName,
      phoneNumber: cleanText(row.phoneNumber) || null,
      phoneMasked: maskPhone(row.phoneNumber),
    };
    if (!hasUsableIdentity(customer)) {
      return [];
    }
    const serviceName = cleanText(row.lastService, "Unknown service");
    const serviceUsage = buildServiceUsageSnapshots({
      focusServiceName: serviceName,
      focusRows: [],
      otherRows: [],
      fallbackRemainingSessions: row.remainingSessions,
    });

    return [
      {
        source: "bigquery",
        sourceRefId: `vip:${customer.customerKey}:${row.lastVisitDate ?? "unknown"}`,
        actionType: "inactive_vip_recovery",
        basePriorityScore: 85,
        title: "Recover inactive VIP customer",
        summary: `${row.customerName} is a high-value customer who has not visited recently.`,
        reason: "Customer has high lifetime spend and no recent visit, so personal follow-up may recover future revenue.",
        recommendedAction: "Owner or senior staff should personally contact this customer and offer help booking a suitable service.",
        evidence: [
          { label: "Lifetime spend", value: moneyLabel(row.lifetimeSpend) ?? row.lifetimeSpend },
          { label: "Visit count", value: row.visitCount },
          ...(row.lastVisitDate ? [{ label: "Last visit date", value: row.lastVisitDate }] : []),
          ...(row.daysSinceLastVisit != null ? [{ label: "Days since last visit", value: row.daysSinceLastVisit }] : []),
          { label: "Last service", value: cleanText(row.lastService, "Unknown") },
          { label: "Primary therapist", value: cleanText(row.primaryTherapist, "Unknown") },
          { label: "Remaining package sessions", value: row.remainingSessions },
          { label: "Customer health score", value: row.healthScore },
        ],
        customer,
        service: {
          serviceName,
          lastVisitDate: row.lastVisitDate,
          lastVisitSinceDays: row.daysSinceLastVisit,
          lastTreatmentTherapist: cleanText(row.primaryTherapist) || null,
          preferredTherapist: cleanText(row.primaryTherapist) || null,
        },
        serviceUsage,
      },
    ];
  });
}

function uniqueCandidates(candidates: Candidate[]) {
  const byKey = new Map<string, Candidate>();

  for (const candidate of candidates) {
    const key = [
      candidate.actionType,
      candidate.customer.customerKey || candidate.customer.memberId || candidate.customer.phoneNumber || candidate.customer.customerName,
      candidate.sourceRefId,
    ].join("|");
    const current = byKey.get(key);
    if (!current || candidate.basePriorityScore > current.basePriorityScore) {
      byKey.set(key, candidate);
    }
  }

  return [...byKey.values()];
}

function candidateFocusKey(candidate: Candidate) {
  return (
    candidate.customer.customerKey ||
    cleanText(candidate.customer.memberId) ||
    normalizePhone(candidate.customer.phoneNumber) ||
    normalizeNameKey(candidate.customer.customerName) ||
    candidate.sourceRefId
  );
}

function selectTopFocusCandidates(input: {
  candidates: Candidate[];
  existingActions: AiRevenueAction[];
  upcomingCustomers: AiRevenueCustomer[];
  limit: number;
}) {
  const scoredCandidates = input.candidates
    .map((candidate) => ({
      candidate,
      score: applyPriorityAdjustments({
        candidate,
        existingActions: input.existingActions,
        upcomingCustomers: input.upcomingCustomers,
      }),
    }))
    .filter((item) => item.score > 0 && hasUsableIdentity(item.candidate.customer))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.candidate.basePriorityScore - left.candidate.basePriorityScore ||
        left.candidate.title.localeCompare(right.candidate.title),
    );

  const byCustomer = new Map<string, { candidate: Candidate; score: number }>();
  for (const item of scoredCandidates) {
    const key = candidateFocusKey(item.candidate);
    if (!byCustomer.has(key)) {
      byCustomer.set(key, item);
    }
    if (byCustomer.size >= input.limit) {
      break;
    }
  }

  return [...byCustomer.values()];
}

export async function generateAiRevenueOpportunities(input: GenerateInput) {
  // Remaining package balances can stay actionable long after purchase.
  const packageFromDate = addDays(input.dateKey, -730);
  const customerFromDate = addDays(input.dateKey, -365);
  const appointmentHistoryFromDate = addDays(input.dateKey, -90);
  const tomorrowDateKey = addDays(input.dateKey, 1);

  const [packageResult, customerResult, vipResult, todayAppointmentsResult, tomorrowAppointmentsResult, appointmentHistoryResult] =
    await Promise.allSettled([
      getPackagePortalReport({
        clinicId: input.clinicId,
        fromDate: packageFromDate,
        toDate: input.dateKey,
        packageId: "",
        category: "",
        therapist: "",
        salesperson: "",
        status: "",
        inactivityBucket: "",
        onlyRemaining: true,
        authorizationHeader: input.authorizationHeader,
      }),
      getCustomerPortalList({
        clinicCode: input.clinicCode,
        fromDate: customerFromDate,
        toDate: input.dateKey,
        search: "",
        status: "",
        spendTier: "",
        therapist: "",
        serviceCategory: "",
        sortBy: "lastVisitDate",
        sortDirection: "asc",
        limit: CUSTOMER_FOCUS_LIMIT,
        offset: 0,
      }),
      getCustomerPortalList({
        clinicCode: input.clinicCode,
        fromDate: customerFromDate,
        toDate: input.dateKey,
        search: "",
        status: "",
        spendTier: "VIP",
        therapist: "",
        serviceCategory: "",
        sortBy: "lifetimeSpend",
        sortDirection: "desc",
        limit: 80,
        offset: 0,
      }),
      getTodayAppointmentsForClinic({
        clinicCode: input.clinicCode,
        dateKey: input.dateKey,
        timezone: env.DEFAULT_TIMEZONE,
        authorizationHeader: input.authorizationHeader,
      }),
      getTodayAppointmentsForClinic({
        clinicCode: input.clinicCode,
        dateKey: tomorrowDateKey,
        timezone: env.DEFAULT_TIMEZONE,
        authorizationHeader: input.authorizationHeader,
      }),
      fetchAppointmentHistory({
        clinicCode: input.clinicCode,
        fromDate: appointmentHistoryFromDate,
        toDate: addDays(input.dateKey, -1),
        authorizationHeader: input.authorizationHeader,
      }),
    ]);

  const customerRows = customerResult.status === "fulfilled" ? customerResult.value.rows : [];
  const vipRows = vipResult.status === "fulfilled" ? vipResult.value.rows : [];
  const todayRows = todayAppointmentsResult.status === "fulfilled" ? todayAppointmentsResult.value.rows : [];
  const tomorrowRows = tomorrowAppointmentsResult.status === "fulfilled" ? tomorrowAppointmentsResult.value.rows : [];
  const appointmentHistoryRows = appointmentHistoryResult.status === "fulfilled" ? appointmentHistoryResult.value : [];
  const packagePortalRows = packageResult.status === "fulfilled" ? packageResult.value.followUpRows : [];
  const customerPackageRows =
    customerRows.length > 0
      ? await fetchCustomerPackageFallbackRows({
          clinicCode: input.clinicCode,
          dateKey: input.dateKey,
          rows: customerRows,
        })
      : [];
  const packageRows = mergePackageRows([...packagePortalRows, ...customerPackageRows]);

  const highRiskCustomers = buildHighRiskAppointmentCustomerSet(appointmentHistoryRows);
  const upcomingCustomers = [...todayRows, ...tomorrowRows]
    .filter(isActiveAppointment)
    .map(buildAppointmentCustomer)
    .filter(hasUsableIdentity);
  const existingActions = await listActions({
    clinicId: input.clinicId,
    limit: 500,
    includeResolved: true,
    includeHidden: true,
  });
  const existingIds = new Set(existingActions.map((action) => action.id));
  const existingByOpportunityKey = new Map<string, AiRevenueAction[]>();
  for (const action of existingActions) {
    const key = action.opportunityKey ?? buildOpportunityKey(action);
    const actions = existingByOpportunityKey.get(key) ?? [];
    actions.push(action);
    existingByOpportunityKey.set(key, actions);
  }
  const activeSuppressions = await listActiveCustomerSuppressions({
    clinicId: input.clinicId,
    dateKey: input.dateKey,
  });

  const candidates = uniqueCandidates([
    ...createServiceReminderCandidates({
      rows: customerRows,
      dateKey: input.dateKey,
      packageRows,
    }),
    ...createPackageCandidates(packageRows),
    ...createAppointmentCandidates({
      todayRows,
      tomorrowRows,
      dateKey: input.dateKey,
      highRiskCustomers,
    }),
    ...createInactiveVipCandidates(vipRows),
  ]).filter(
    (candidate) =>
      !isOpportunitySuppressed(
        {
          customer: candidate.customer,
          service: candidate.service,
        },
        activeSuppressions,
        input.dateKey,
      ),
  );
  const focusCandidates = selectTopFocusCandidates({
    candidates,
    existingActions,
    upcomingCustomers,
    limit: CUSTOMER_FOCUS_LIMIT,
  });
  const saved: AiRevenueAction[] = [];
  const skippedExisting: AiRevenueAction[] = [];
  const refreshedExisting: AiRevenueAction[] = [];

  for (const { candidate, score } of focusCandidates) {
    const action = baseAction(input, candidate, score);
    const sameOpportunityActions = existingByOpportunityKey.get(action.opportunityKey ?? buildOpportunityKey(action)) ?? [];
    const openAction = sameOpportunityActions.find(isOpenWorkflowAction);
    if (openAction) {
      const contextChanged = didGeneratedContextChange(openAction, action);
      const refreshedAction = await upsertAction(mergeGeneratedActionContext(openAction, action));
      if (contextChanged) {
        await createAuditLog({
          clinicId: input.clinicId,
          actionId: refreshedAction.id,
          actorType: "system",
          actorId: "ai_revenue_generator",
          action: "opportunity_refreshed",
          description: "Refreshed AI Revenue opportunity evidence from latest source data without resetting staff follow-up workflow.",
          beforeValue: {
            reason: openAction.reason,
            evidence: openAction.evidence,
            packageInfo: openAction.packageInfo,
            serviceUsage: openAction.serviceUsage ?? [],
            priorityScore: openAction.priorityScore,
            dueDateKey: openAction.dueDateKey,
            nextFollowUpAt: openAction.nextFollowUpAt,
            workflowState: openAction.workflowState,
            attemptCount: openAction.attemptCount,
            lastContactResult: openAction.lastContactResult,
          },
          afterValue: {
            reason: refreshedAction.reason,
            evidence: refreshedAction.evidence,
            packageInfo: refreshedAction.packageInfo,
            serviceUsage: refreshedAction.serviceUsage ?? [],
            priorityScore: refreshedAction.priorityScore,
            dueDateKey: refreshedAction.dueDateKey,
            nextFollowUpAt: refreshedAction.nextFollowUpAt,
            workflowState: refreshedAction.workflowState,
            attemptCount: refreshedAction.attemptCount,
            lastContactResult: refreshedAction.lastContactResult,
          },
        });
      }
      refreshedExisting.push(refreshedAction);
      continue;
    }

    const closedAction = sameOpportunityActions.find(isCompletedOrSuppressedWorkflowAction);
    if (closedAction && !input.forceRefresh) {
      skippedExisting.push(closedAction);
      continue;
    }

    if (existingIds.has(action.id) && !input.forceRefresh) {
      const existing = existingActions.find((item) => item.id === action.id);
      if (existing) {
        skippedExisting.push(existing);
      }
      continue;
    }

    const nextAction = await upsertAction(action);
    await createAuditLog({
      clinicId: input.clinicId,
      actionId: nextAction.id,
      actorType: "system",
      actorId: "ai_revenue_generator",
      action: "opportunity_created",
      description: `Created from ${candidate.source} opportunity generation.`,
      afterValue: {
        actionType: nextAction.actionType,
        sourceRefId: nextAction.sourceRefId,
        priorityScore: nextAction.priorityScore,
      },
    });
    saved.push(nextAction);
  }

  return {
    dateKey: input.dateKey,
    generatedCount: saved.length,
    skippedExistingCount: skippedExisting.length,
    refreshedExistingCount: refreshedExisting.length,
    actions: [...saved, ...refreshedExisting, ...skippedExisting].sort(
      (left, right) => right.priorityScore - left.priorityScore || left.title.localeCompare(right.title),
    ),
    sourceStatus: {
      packagePortal: packageResult.status,
      customerPortal: customerResult.status,
      vipCustomers: vipResult.status,
      todayAppointments: todayAppointmentsResult.status,
      tomorrowAppointments: tomorrowAppointmentsResult.status,
      appointmentHistory: appointmentHistoryResult.status,
    },
  };
}
