import { createHash } from "node:crypto";
import { firestoreDb } from "../../config/firebase.js";
import { HttpError } from "../../utils/http-error.js";
import {
  aiRevenueActionSources,
  aiRevenueActionStatuses,
  aiRevenueActionTypes,
  aiRevenueAttributionTypes,
  aiRevenueContactChannels,
  aiRevenueContactResults,
  aiRevenueFollowUpChannels,
  aiRevenueFollowUpResults,
  aiRevenueFollowUpScheduleOptions,
  aiRevenueFollowUpStatuses,
  aiRevenueOutcomeTypes,
  aiRevenueResolutionReasons,
  aiRevenueSuppressionScopes,
  aiRevenueVisibilityStates,
  aiRevenueWorkflowStates,
  type AiRevenueAction,
  type AiRevenueActionResolution,
  type AiRevenuePriority,
  type AiRevenueActionSource,
  type AiRevenueActionStatus,
  type AiRevenueActionType,
  type AiRevenueAppointmentInfo,
  type AiRevenueAppointmentOutcome,
  type AiRevenueAuditActorType,
  type AiRevenueAuditLog,
  type AiRevenueContactAttempt,
  type AiRevenueContactChannel,
  type AiRevenueContactResult,
  type AiRevenueCustomerTimelineEvent,
  type AiRevenueFollowUpAttempt,
  type AiRevenueFollowUpChannel,
  type AiRevenueFollowUpInfo,
  type AiRevenueFollowUpResult,
  type AiRevenueFollowUpScheduleOption,
  type AiRevenueFollowUpStatus,
  type AiRevenueMessageEvent,
  type AiRevenueOutcomeLink,
  type AiRevenueOutcomeType,
  type AiRevenueMessageInfo,
  type AiRevenueRevenueInfo,
  type AiRevenueServiceInfo,
  type AiRevenueServiceUsageSnapshot,
  type AiRevenueSettings,
  type AiRevenueSummary,
  type AiRevenueActor,
  type AiRevenueCustomer,
  type AiRevenueCustomerSuppression,
  type AiRevenueResolutionReason,
  type AiRevenueSuppressionScope,
  type AiRevenueVisibilityState,
  type AiRevenueWorkflowState,
} from "../../types/ai-revenue-agent.js";

const ACTIONS_COLLECTION = "gt_ai_revenue_actions";
const MESSAGE_EVENTS_COLLECTION = "gt_ai_revenue_message_events";
const FOLLOW_UP_ATTEMPTS_COLLECTION = "gt_ai_revenue_follow_up_attempts";
const CONTACT_ATTEMPTS_COLLECTION = "gt_ai_revenue_contact_attempts";
const OUTCOME_LINKS_COLLECTION = "gt_ai_revenue_outcome_links";
const CUSTOMER_TIMELINE_EVENTS_COLLECTION = "gt_ai_revenue_customer_timeline_events";
const APPOINTMENT_OUTCOMES_COLLECTION = "gt_ai_revenue_appointment_outcomes";
const AUDIT_LOGS_COLLECTION = "gt_ai_revenue_audit_logs";
const SETTINGS_COLLECTION = "gt_ai_revenue_settings";
const CUSTOMER_SUPPRESSIONS_COLLECTION = "gt_ai_revenue_customer_suppressions";
const BATCH_RUNS_COLLECTION = "gt_ai_revenue_batch_runs";
const CLINIC_RUNS_COLLECTION = "gt_ai_revenue_clinic_runs";
const AI_REVENUE_RUNS_COLLECTION = "gt_ai_revenue_runs";
const RESOLVED_STATUSES = new Set<AiRevenueActionStatus>(["closed", "skipped", "not_interested"]);

export type AiRevenueScheduledRunStatus = "running" | "completed" | "skipped" | "failed";

export type AiRevenueClinicRunRecord = {
  id: string;
  jobName: string;
  clinicId: string;
  clinicCode?: string | null;
  clinicName?: string | null;
  dateKey: string;
  timezone: string;
  status: AiRevenueScheduledRunStatus;
  startedAt: string;
  completedAt: string | null;
  lockExpiresAt?: string | null;
  createdCount: number;
  duplicateSkippedCount: number;
  suppressedSkippedCount: number;
  errorMessage: string | null;
};

export type AiRevenueBatchRunSummary = {
  totalClinics: number;
  dueClinics?: number;
  processedClinics: number;
  skippedClinics: number;
  failedClinics: number;
  totalCreated: number;
  totalDuplicateSkipped: number;
  totalSuppressedSkipped: number;
  dryRun?: boolean;
  skippedReason?: string | null;
};

export type AiRevenueRunSummaryRecord = {
  id: string;
  clinicId: string;
  clinicCode: string | null;
  dateKey: string;
  status: "completed";
  generatedCount: number;
  skippedExistingCount: number;
  refreshedExistingCount: number;
  actionCount: number;
  sourceStatus: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

function nowIso() {
  return new Date().toISOString();
}

function actionCollection() {
  return firestoreDb().collection(ACTIONS_COLLECTION);
}

function messageEventCollection() {
  return firestoreDb().collection(MESSAGE_EVENTS_COLLECTION);
}

function followUpAttemptCollection() {
  return firestoreDb().collection(FOLLOW_UP_ATTEMPTS_COLLECTION);
}

function contactAttemptCollection() {
  return firestoreDb().collection(CONTACT_ATTEMPTS_COLLECTION);
}

function outcomeLinkCollection() {
  return firestoreDb().collection(OUTCOME_LINKS_COLLECTION);
}

function customerTimelineEventCollection() {
  return firestoreDb().collection(CUSTOMER_TIMELINE_EVENTS_COLLECTION);
}

function appointmentOutcomeCollection() {
  return firestoreDb().collection(APPOINTMENT_OUTCOMES_COLLECTION);
}

function auditLogCollection() {
  return firestoreDb().collection(AUDIT_LOGS_COLLECTION);
}

function settingsCollection() {
  return firestoreDb().collection(SETTINGS_COLLECTION);
}

function customerSuppressionCollection() {
  return firestoreDb().collection(CUSTOMER_SUPPRESSIONS_COLLECTION);
}

function batchRunCollection() {
  return firestoreDb().collection(BATCH_RUNS_COLLECTION);
}

function clinicRunCollection() {
  return firestoreDb().collection(CLINIC_RUNS_COLLECTION);
}

function aiRevenueRunCollection() {
  return firestoreDb().collection(AI_REVENUE_RUNS_COLLECTION);
}

function cleanText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nullableText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizePhone(value: unknown) {
  return cleanText(value).replace(/\D/g, "");
}

export function phoneHash(value: unknown) {
  const phone = normalizePhone(value);
  return phone ? createHash("sha1").update(phone).digest("hex") : null;
}

function hashId(value: string) {
  return createHash("sha1").update(value).digest("hex").slice(0, 24);
}

function todayDateKey() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetweenDateKeys(laterDateKey: string, earlierDateKey: string) {
  const later = new Date(`${laterDateKey.slice(0, 10)}T00:00:00.000Z`);
  const earlier = new Date(`${earlierDateKey.slice(0, 10)}T00:00:00.000Z`);

  if (Number.isNaN(later.getTime()) || Number.isNaN(earlier.getTime())) {
    return null;
  }

  return Math.max(0, Math.round((later.getTime() - earlier.getTime()) / 86_400_000));
}

function dateKeyFromIso(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

function strongCustomerKey(value: unknown) {
  const key = nullableText(value);
  return key && !key.startsWith("name:") ? key : null;
}

function numberOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberOrZero(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeLastVisitSinceDays(rawDays: unknown, rawLastVisitDate: unknown) {
  const storedDays = numberOrNull(rawDays);
  const lastVisitDateKey = dateKeyFromIso(rawLastVisitDate);
  const daysFromDate = lastVisitDateKey ? daysBetweenDateKeys(todayDateKey(), lastVisitDateKey) : null;

  if (daysFromDate != null) {
    return storedDays != null && Math.abs(storedDays - daysFromDate) <= 1 ? Math.max(0, Math.round(storedDays)) : daysFromDate;
  }

  return storedDays == null ? null : Math.max(0, Math.round(storedDays));
}

function stripUndefinedDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, stripUndefinedDeep(item)]),
    );
  }

  return value;
}

function normalizeActor(value: unknown): AiRevenueActor | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const data = value as Record<string, unknown>;
  return {
    userId: nullableText(data.userId),
    email: nullableText(data.email),
    name: nullableText(data.name),
  };
}

function defaultMessage(): AiRevenueMessageInfo {
  return {
    channel: null,
    draftText: null,
    approvedText: null,
    approvedBy: null,
    approvedAt: null,
    sentAt: null,
    providerMessageId: null,
    lastInboundText: null,
    lastInboundIntent: null,
    lastInboundAt: null,
  };
}

function defaultAppointment(): AiRevenueAppointmentInfo {
  return {
    bookingId: null,
    appointmentDateTime: null,
    bookingStatus: null,
    requestMode: null,
    serviceId: null,
    serviceName: null,
    practitionerId: null,
    practitionerName: null,
    note: null,
    attributionNote: null,
    requestedAt: null,
    reminderSentAt: null,
    cameAt: null,
    cancelledAt: null,
    noShowAt: null,
    completedAt: null,
  };
}

function defaultRevenue(): AiRevenueRevenueInfo {
  return {
    actualRevenue: 0,
    influencedRevenue: 0,
    packageSessionsRecovered: 0,
    orderId: null,
    invoiceNumber: null,
    attributionType: "unknown",
    revenueAt: null,
    revenueNote: null,
  };
}

function normalizeMessage(value: unknown): AiRevenueMessageInfo {
  const defaults = defaultMessage();
  if (!value || typeof value !== "object") {
    return defaults;
  }

  const data = value as Record<string, unknown>;
  return {
    channel: nullableText(data.channel),
    draftText: nullableText(data.draftText),
    approvedText: nullableText(data.approvedText),
    approvedBy: normalizeActor(data.approvedBy),
    approvedAt: nullableText(data.approvedAt),
    sentAt: nullableText(data.sentAt),
    providerMessageId: nullableText(data.providerMessageId),
    lastInboundText: nullableText(data.lastInboundText),
    lastInboundIntent: nullableText(data.lastInboundIntent),
    lastInboundAt: nullableText(data.lastInboundAt),
  };
}

function normalizeAppointment(value: unknown): AiRevenueAppointmentInfo {
  const defaults = defaultAppointment();
  if (!value || typeof value !== "object") {
    return defaults;
  }

  const data = value as Record<string, unknown>;
  return {
    bookingId: nullableText(data.bookingId),
    appointmentDateTime: nullableText(data.appointmentDateTime),
    bookingStatus: nullableText(data.bookingStatus),
    requestMode: data.requestMode === "direct_booking" ? "direct_booking" : data.requestMode === "booking_request" ? "booking_request" : null,
    serviceId: nullableText(data.serviceId),
    serviceName: nullableText(data.serviceName),
    practitionerId: nullableText(data.practitionerId),
    practitionerName: nullableText(data.practitionerName),
    note: nullableText(data.note),
    attributionNote: nullableText(data.attributionNote),
    requestedAt: nullableText(data.requestedAt),
    reminderSentAt: nullableText(data.reminderSentAt),
    cameAt: nullableText(data.cameAt),
    cancelledAt: nullableText(data.cancelledAt),
    noShowAt: nullableText(data.noShowAt),
    completedAt: nullableText(data.completedAt),
  };
}

function normalizeRevenue(value: unknown): AiRevenueRevenueInfo {
  const defaults = defaultRevenue();
  if (!value || typeof value !== "object") {
    return defaults;
  }

  const data = value as Record<string, unknown>;
  const attributionType = aiRevenueAttributionTypes.includes(data.attributionType as NonNullable<AiRevenueRevenueInfo["attributionType"]>)
    ? (data.attributionType as NonNullable<AiRevenueRevenueInfo["attributionType"]>)
    : "unknown";

  return {
    actualRevenue: numberOrZero(data.actualRevenue),
    influencedRevenue: numberOrZero(data.influencedRevenue),
    packageSessionsRecovered: numberOrZero(data.packageSessionsRecovered),
    orderId: nullableText(data.orderId),
    invoiceNumber: nullableText(data.invoiceNumber),
    attributionType,
    revenueAt: nullableText(data.revenueAt),
    revenueNote: nullableText(data.revenueNote),
  };
}

function normalizeWorkflowState(
  value: unknown,
  input?: {
    status?: AiRevenueActionStatus;
    resolution?: AiRevenueActionResolution | null;
  },
): AiRevenueWorkflowState {
  if (aiRevenueWorkflowStates.includes(value as AiRevenueWorkflowState)) {
    return value as AiRevenueWorkflowState;
  }

  if (input?.resolution || (input?.status && RESOLVED_STATUSES.has(input.status))) {
    return "closed";
  }

  switch (input?.status) {
    case "sent":
    case "customer_replied":
    case "human_takeover":
      return "contacted";
    case "appointment_created":
    case "appointment_confirmed":
    case "appointment_requested":
      return "appointment_booked";
    case "completed":
    case "revenue_attributed":
    case "customer_came":
      return "completed";
    default:
      return "new";
  }
}

function normalizeVisibilityState(
  value: unknown,
  input?: {
    status?: AiRevenueActionStatus;
    resolution?: AiRevenueActionResolution | null;
  },
): AiRevenueVisibilityState {
  if (aiRevenueVisibilityStates.includes(value as AiRevenueVisibilityState)) {
    return value as AiRevenueVisibilityState;
  }

  if (input?.resolution || (input?.status && RESOLVED_STATUSES.has(input.status))) {
    return "completed";
  }

  return "active";
}

function normalizeContactChannel(value: unknown): AiRevenueContactChannel {
  if (aiRevenueContactChannels.includes(value as AiRevenueContactChannel)) {
    return value as AiRevenueContactChannel;
  }

  switch (value) {
    case "phone_call":
      return "phone";
    case "manual_viber":
      return "viber_manual";
    default:
      return "other";
  }
}

function normalizeContactResult(value: unknown): AiRevenueContactResult {
  return aiRevenueContactResults.includes(value as AiRevenueContactResult)
    ? (value as AiRevenueContactResult)
    : "other";
}

function normalizeOutcomeType(value: unknown): AiRevenueOutcomeType {
  return aiRevenueOutcomeTypes.includes(value as AiRevenueOutcomeType)
    ? (value as AiRevenueOutcomeType)
    : "revenue_attributed";
}

function normalizeServiceUsage(value: unknown): AiRevenueServiceUsageSnapshot[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => {
      const status =
        item.status === "active" ||
        item.status === "low_remaining" ||
        item.status === "completed" ||
        item.status === "unknown"
          ? item.status
          : "unknown";
      return {
        serviceId: nullableText(item.serviceId),
        serviceName: cleanText(item.serviceName, cleanText(item.packageName, "Unknown service")),
        packageId: nullableText(item.packageId),
        packageName: nullableText(item.packageName),
        packageTotal: numberOrNull(item.packageTotal),
        used: numberOrNull(item.used),
        remaining: numberOrNull(item.remaining),
        latestUsageDate: nullableText(item.latestUsageDate),
        latestTherapist: nullableText(item.latestTherapist),
        status,
        isFocusService: typeof item.isFocusService === "boolean" ? item.isFocusService : false,
        note: nullableText(item.note),
      };
    });
}

function normalizeFollowUpChannel(value: unknown): AiRevenueFollowUpChannel | null {
  return aiRevenueFollowUpChannels.includes(value as AiRevenueFollowUpChannel)
    ? (value as AiRevenueFollowUpChannel)
    : null;
}

function normalizeFollowUpResult(value: unknown): AiRevenueFollowUpResult | null {
  return aiRevenueFollowUpResults.includes(value as AiRevenueFollowUpResult)
    ? (value as AiRevenueFollowUpResult)
    : null;
}

function normalizeFollowUpScheduleOption(value: unknown): AiRevenueFollowUpScheduleOption {
  return aiRevenueFollowUpScheduleOptions.includes(value as AiRevenueFollowUpScheduleOption)
    ? (value as AiRevenueFollowUpScheduleOption)
    : "none";
}

function normalizeFollowUpStatus(value: unknown): AiRevenueFollowUpStatus {
  return aiRevenueFollowUpStatuses.includes(value as AiRevenueFollowUpStatus)
    ? (value as AiRevenueFollowUpStatus)
    : "open";
}

function defaultFollowUpOutcome(): AiRevenueFollowUpInfo["outcome"] {
  return {
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
  };
}

function normalizeFollowUpOutcome(value: unknown): AiRevenueFollowUpInfo["outcome"] {
  const defaults = defaultFollowUpOutcome();
  if (!value || typeof value !== "object") {
    return defaults;
  }

  const data = value as Record<string, unknown>;
  const attributionType = aiRevenueAttributionTypes.includes(data.attributionType as NonNullable<AiRevenueRevenueInfo["attributionType"]>)
    ? (data.attributionType as NonNullable<AiRevenueRevenueInfo["attributionType"]>)
    : "unknown";

  return {
    appointmentBookingId: nullableText(data.appointmentBookingId),
    appointmentBookedAt: nullableText(data.appointmentBookedAt),
    appointmentDateTime: nullableText(data.appointmentDateTime),
    customerCameAt: nullableText(data.customerCameAt),
    treatmentCompletedAt: nullableText(data.treatmentCompletedAt),
    packageSessionUsedAt: nullableText(data.packageSessionUsedAt),
    packageSessionsRecovered: numberOrZero(data.packageSessionsRecovered),
    repurchaseInvoiceNumber: nullableText(data.repurchaseInvoiceNumber),
    repurchaseRevenue: numberOrZero(data.repurchaseRevenue),
    revenueAttributedAt: nullableText(data.revenueAttributedAt),
    attributionType,
  };
}

function defaultFollowUp(input: {
  dateKey: string;
  status: AiRevenueActionStatus;
  resolution: AiRevenueActionResolution | null;
}): AiRevenueFollowUpInfo {
  const suppressed = Boolean(input.resolution?.suppressCustomer);
  const completed = Boolean(input.resolution || RESOLVED_STATUSES.has(input.status));

  return {
    status: suppressed ? "suppressed" : completed ? "completed" : "open",
    dueDate: input.dateKey,
    nextFollowUpDate: suppressed || completed ? null : input.dateKey,
    lastAttemptId: null,
    lastContactedAt: null,
    lastChannel: null,
    lastResult: null,
    lastNote: null,
    lastHandledBy: null,
    attemptCount: 0,
    completedAt: input.resolution?.resolvedAt ?? null,
    completedBy: input.resolution?.resolvedBy ?? null,
    suppressedAt: suppressed ? input.resolution?.resolvedAt ?? null : null,
    suppressionId: input.resolution?.suppressionId ?? null,
    outcome: defaultFollowUpOutcome(),
  };
}

function normalizeFollowUp(
  value: unknown,
  defaults: AiRevenueFollowUpInfo,
): AiRevenueFollowUpInfo {
  if (!value || typeof value !== "object") {
    return defaults;
  }

  const data = value as Record<string, unknown>;
  const status = normalizeFollowUpStatus(data.status);

  return {
    status,
    dueDate: nullableText(data.dueDate) ?? defaults.dueDate,
    nextFollowUpDate: nullableText(data.nextFollowUpDate),
    lastAttemptId: nullableText(data.lastAttemptId),
    lastContactedAt: nullableText(data.lastContactedAt),
    lastChannel: normalizeFollowUpChannel(data.lastChannel),
    lastResult: normalizeFollowUpResult(data.lastResult),
    lastNote: nullableText(data.lastNote),
    lastHandledBy: normalizeActor(data.lastHandledBy),
    attemptCount: Math.max(0, Math.round(numberOrZero(data.attemptCount))),
    completedAt: nullableText(data.completedAt),
    completedBy: normalizeActor(data.completedBy),
    suppressedAt: nullableText(data.suppressedAt),
    suppressionId: nullableText(data.suppressionId),
    outcome: normalizeFollowUpOutcome(data.outcome),
  };
}

function normalizeResolution(value: unknown): AiRevenueActionResolution | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const data = value as Record<string, unknown>;
  const reason = aiRevenueResolutionReasons.includes(data.reason as AiRevenueResolutionReason)
    ? (data.reason as AiRevenueResolutionReason)
    : null;
  const resolvedAt = nullableText(data.resolvedAt);
  if (!reason || !resolvedAt) {
    return null;
  }

  return {
    reason,
    note: nullableText(data.note),
    suppressCustomer: typeof data.suppressCustomer === "boolean" ? data.suppressCustomer : false,
    suppressionId: nullableText(data.suppressionId),
    resolvedAt,
    resolvedBy: normalizeActor(data.resolvedBy),
  };
}

function normalizeAttributionType(value: unknown) {
  return aiRevenueAttributionTypes.includes(value as NonNullable<AiRevenueRevenueInfo["attributionType"]>)
    ? (value as NonNullable<AiRevenueRevenueInfo["attributionType"]>)
    : "unknown";
}

function normalizeContactAttempt(id: string, data: FirebaseFirestore.DocumentData | undefined): AiRevenueContactAttempt | null {
  if (!data || typeof data.clinicId !== "string" || typeof data.actionId !== "string") {
    return null;
  }

  return {
    id,
    clinicId: data.clinicId,
    actionId: data.actionId,
    opportunityKey: nullableText(data.opportunityKey),
    customerKey: nullableText(data.customerKey),
    memberId: nullableText(data.memberId),
    phoneHash: nullableText(data.phoneHash),
    customerName: nullableText(data.customerName),
    agentUserId: nullableText(data.agentUserId),
    agentName: nullableText(data.agentName),
    channel: normalizeContactChannel(data.channel),
    result: normalizeContactResult(data.result),
    note: nullableText(data.note),
    messageText: nullableText(data.messageText),
    nextFollowUpAt: nullableText(data.nextFollowUpAt),
    nextFollowUpDateKey: nullableText(data.nextFollowUpDateKey),
    createdAt: cleanText(data.createdAt, nowIso()),
    createdBy: normalizeActor(data.createdBy),
  };
}

function normalizeOutcomeLink(id: string, data: FirebaseFirestore.DocumentData | undefined): AiRevenueOutcomeLink | null {
  if (!data || typeof data.clinicId !== "string" || typeof data.actionId !== "string") {
    return null;
  }

  return {
    id,
    clinicId: data.clinicId,
    actionId: data.actionId,
    opportunityKey: nullableText(data.opportunityKey),
    contactAttemptId: nullableText(data.contactAttemptId),
    customerKey: nullableText(data.customerKey),
    memberId: nullableText(data.memberId),
    phoneHash: nullableText(data.phoneHash),
    outcomeType: normalizeOutcomeType(data.outcomeType),
    bookingId: nullableText(data.bookingId),
    treatmentId: nullableText(data.treatmentId),
    orderId: nullableText(data.orderId),
    invoiceNumber: nullableText(data.invoiceNumber),
    serviceId: nullableText(data.serviceId),
    serviceName: nullableText(data.serviceName),
    revenueAmount: numberOrNull(data.revenueAmount),
    packageSessionsRecovered: numberOrNull(data.packageSessionsRecovered),
    attributionType: normalizeAttributionType(data.attributionType),
    attributionWindowDays: numberOrNull(data.attributionWindowDays),
    confidence: numberOrNull(data.confidence),
    eventAt: cleanText(data.eventAt, cleanText(data.createdAt, nowIso())),
    createdAt: cleanText(data.createdAt, nowIso()),
  };
}

function normalizeCustomerTimelineEvent(
  id: string,
  data: FirebaseFirestore.DocumentData | undefined,
): AiRevenueCustomerTimelineEvent | null {
  if (!data || typeof data.clinicId !== "string" || typeof data.actionId !== "string") {
    return null;
  }

  return {
    id,
    clinicId: data.clinicId,
    actionId: data.actionId,
    contactAttemptId: cleanText(data.contactAttemptId),
    customerKey: nullableText(data.customerKey),
    memberId: nullableText(data.memberId),
    phoneHash: nullableText(data.phoneHash),
    customerName: nullableText(data.customerName),
    eventType: "service_follow_up",
    serviceName: nullableText(data.serviceName),
    result: normalizeContactResult(data.result),
    channel: normalizeContactChannel(data.channel),
    note: nullableText(data.note),
    nextFollowUpAt: nullableText(data.nextFollowUpAt),
    createdAt: cleanText(data.createdAt, nowIso()),
    createdBy: normalizeActor(data.createdBy),
    externalTimelineId: nullableText(data.externalTimelineId),
  };
}

export function buildOpportunityKey(input: {
  clinicId: string;
  actionType?: AiRevenueActionType | string | null;
  customer?: AiRevenueCustomer | null;
  service?: AiRevenueServiceInfo | null;
  packageInfo?: {
    packageId?: string | null;
    packageName?: string | null;
  } | null;
  phoneHash?: string | null;
}) {
  const identity =
    cleanText(input.customer?.memberId) ||
    strongCustomerKey(input.customer?.customerKey) ||
    nullableText(input.phoneHash) ||
    phoneHash(input.customer?.phoneNumber) ||
    cleanText(input.customer?.customerName, "unknown_customer");
  const serviceIdentity =
    cleanText(input.service?.serviceId) ||
    normalizeMatchText(input.service?.serviceName) ||
    "no_service";
  const packageIdentity =
    cleanText(input.packageInfo?.packageId) ||
    normalizeMatchText(input.packageInfo?.packageName) ||
    "no_package";
  const rawKey = [
    cleanText(input.clinicId, "unknown_clinic"),
    normalizeMatchText(identity),
    cleanText(input.actionType, "unknown_action"),
    serviceIdentity,
    packageIdentity,
  ].join("|");

  return `opp_${hashId(rawKey)}`;
}

function normalizeAction(id: string, data: FirebaseFirestore.DocumentData | undefined): AiRevenueAction | null {
  if (!data || typeof data.clinicId !== "string") {
    return null;
  }

  const source = aiRevenueActionSources.includes(data.source as AiRevenueActionSource)
    ? (data.source as AiRevenueActionSource)
    : "manual";
  const actionType = aiRevenueActionTypes.includes(data.actionType as AiRevenueActionType)
    ? (data.actionType as AiRevenueActionType)
    : "service_reminder_follow_up";
  const status = aiRevenueActionStatuses.includes(data.status as AiRevenueActionStatus)
    ? (data.status as AiRevenueActionStatus)
    : "new";
  const dateKey = cleanText(data.dateKey, todayDateKey());
  const resolution = normalizeResolution(data.resolution);
  const workflowState = normalizeWorkflowState(data.workflowState, { status, resolution });
  const visibilityState = normalizeVisibilityState(data.visibilityState, { status, resolution });
  const originalDateKey = nullableText(data.originalDateKey) ?? dateKey;
  const dueDateKey = nullableText(data.dueDateKey) ?? dateKey ?? todayDateKey();
  const followUp = normalizeFollowUp(
    data.followUp,
    defaultFollowUp({
      dateKey,
      status,
      resolution,
    }),
  );

  const customer = data.customer && typeof data.customer === "object" ? (data.customer as Record<string, unknown>) : {};
  const service = data.service && typeof data.service === "object" ? (data.service as Record<string, unknown>) : {};
  const packageInfo = data.packageInfo && typeof data.packageInfo === "object" ? (data.packageInfo as Record<string, unknown>) : {};
  const normalizedCustomer: AiRevenueCustomer = {
    customerKey: nullableText(customer.customerKey),
    memberId: nullableText(customer.memberId),
    customerName: nullableText(customer.customerName),
    phoneNumber: nullableText(customer.phoneNumber),
    phoneMasked: nullableText(customer.phoneMasked),
  };
  const normalizedService: AiRevenueServiceInfo = {
    serviceId: nullableText(service.serviceId),
    serviceName: nullableText(service.serviceName),
    lastVisitDate: nullableText(service.lastVisitDate),
    lastVisitSinceDays: normalizeLastVisitSinceDays(service.lastVisitSinceDays, service.lastVisitDate),
    lastTreatmentTherapist: nullableText(service.lastTreatmentTherapist),
    preferredTherapist: nullableText(service.preferredTherapist),
    reminderDate: nullableText(service.reminderDate),
  };
  const normalizedPackageInfo = {
    packageId: nullableText(packageInfo.packageId),
    packageName: nullableText(packageInfo.packageName),
    remainingUnits: numberOrNull(packageInfo.remainingUnits),
    purchasedUnits: numberOrNull(packageInfo.purchasedUnits),
    usedUnits: numberOrNull(packageInfo.usedUnits),
    lastUsedAt: nullableText(packageInfo.lastUsedAt),
  };

  return {
    id,
    clinicId: data.clinicId,
    clinicCode: nullableText(data.clinicCode),
    dateKey,
    opportunityKey: nullableText(data.opportunityKey),
    originalDateKey,
    dueDateKey,
    nextFollowUpAt: nullableText(data.nextFollowUpAt),
    source,
    sourceRefId: nullableText(data.sourceRefId),
    actionType,
    workflowState,
    visibilityState,
    assignedToUserId: nullableText(data.assignedToUserId),
    assignedToName: nullableText(data.assignedToName),
    attemptCount: Math.max(0, Math.round(numberOrZero(data.attemptCount))),
    lastContactAt: nullableText(data.lastContactAt),
    lastContactChannel: data.lastContactChannel ? normalizeContactChannel(data.lastContactChannel) : null,
    lastContactResult: data.lastContactResult ? normalizeContactResult(data.lastContactResult) : null,
    lastFollowUpNote: nullableText(data.lastFollowUpNote),
    lastFollowUpAttemptId: nullableText(data.lastFollowUpAttemptId),
    completedAt: nullableText(data.completedAt),
    closedAt: nullableText(data.closedAt),
    closedReason: nullableText(data.closedReason),
    priority: data.priority === "high" || data.priority === "medium" || data.priority === "low" ? data.priority : "low",
    priorityScore: numberOrZero(data.priorityScore),
    title: cleanText(data.title, "AI Revenue action"),
    summary: cleanText(data.summary),
    reason: cleanText(data.reason),
    displayReason: nullableText(data.displayReason),
    evidence: Array.isArray(data.evidence)
      ? data.evidence
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
          .map((item) => ({
            label: cleanText(item.label, "Evidence"),
            value: typeof item.value === "number" ? item.value : cleanText(item.value),
            comparison: nullableText(item.comparison),
          }))
      : [],
    recommendedAction: cleanText(data.recommendedAction),
    aiSuggestion: nullableText(data.aiSuggestion),
    customer: normalizedCustomer,
    service: normalizedService,
    serviceUsage: normalizeServiceUsage(data.serviceUsage),
    packageInfo: normalizedPackageInfo,
    appointment: normalizeAppointment(data.appointment),
    message: normalizeMessage(data.message),
    revenue: normalizeRevenue(data.revenue),
    followUp,
    status,
    createdAt: cleanText(data.createdAt, nowIso()),
    updatedAt: cleanText(data.updatedAt, nowIso()),
    createdBy: normalizeActor(data.createdBy),
    lastStatusAt: nullableText(data.lastStatusAt),
    lastStatusBy: normalizeActor(data.lastStatusBy),
    resolution,
  };
}

function requireAction(action: AiRevenueAction | null, clinicId: string, actionId: string) {
  if (!action || action.clinicId !== clinicId) {
    throw new HttpError(404, `AI Revenue action ${actionId} was not found.`);
  }

  return action;
}

type AiRevenueQueueView =
  | "today"
  | "overdue"
  | "tomorrow"
  | "next_7_days"
  | "all_open"
  | "completed"
  | "suppressed";

function isOpenVisibilityState(state: AiRevenueVisibilityState | undefined) {
  return state === "active" || state === "scheduled";
}

function actionMatchesQueueView(action: AiRevenueAction, queueView: AiRevenueQueueView, today = todayDateKey()) {
  const dueDateKey = action.dueDateKey ?? action.dateKey;
  const visibilityState = action.visibilityState ?? "active";
  const tomorrow = addDays(today, 1);
  const nextWeek = addDays(today, 7);

  switch (queueView) {
    case "today":
      return visibilityState === "active" && dueDateKey <= today;
    case "overdue":
      return visibilityState === "active" && dueDateKey < today;
    case "tomorrow":
      return (visibilityState === "active" || visibilityState === "scheduled") && dueDateKey === tomorrow;
    case "next_7_days":
      return !["completed", "suppressed", "hidden"].includes(visibilityState) && dueDateKey >= tomorrow && dueDateKey <= nextWeek;
    case "all_open":
      return isOpenVisibilityState(visibilityState);
    case "completed":
      return visibilityState === "completed";
    case "suppressed":
      return visibilityState === "suppressed";
    default:
      return true;
  }
}

export async function listActions(params: {
  clinicId: string;
  dateKey?: string;
  dueDateKey?: string;
  dueStartDateKey?: string;
  dueEndDateKey?: string;
  status?: AiRevenueActionStatus;
  source?: AiRevenueActionSource;
  actionType?: AiRevenueActionType;
  priority?: AiRevenuePriority;
  workflowState?: AiRevenueWorkflowState;
  visibilityState?: AiRevenueVisibilityState;
  assignedToUserId?: string;
  lastContactResult?: AiRevenueContactResult;
  includeHidden?: boolean;
  queueView?: AiRevenueQueueView;
  limit?: number;
  includeResolved?: boolean;
}) {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  const fetchLimit = Math.min(Math.max(limit * 5, limit), 500);
  // MVP uses clinicId plus in-memory filters to avoid a large composite-index matrix.
  // Recommended indexes when queue volume grows:
  // gt_ai_revenue_actions: clinicId ASC + visibilityState ASC + dueDateKey ASC + priorityScore DESC
  // gt_ai_revenue_actions: clinicId ASC + assignedToUserId ASC + visibilityState ASC + dueDateKey ASC
  // gt_ai_revenue_actions: clinicId ASC + workflowState ASC + dueDateKey ASC
  // gt_ai_revenue_actions: clinicId ASC + opportunityKey ASC + visibilityState ASC
  let query: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = actionCollection()
    .where("clinicId", "==", params.clinicId);

  if (params.dateKey) {
    query = query.where("dateKey", "==", params.dateKey);
  }

  const snapshot = await query.limit(fetchLimit).get();

  return snapshot.docs
    .map((doc) => normalizeAction(doc.id, doc.data()))
    .filter((action): action is AiRevenueAction => Boolean(action))
    .filter((action) => !params.status || action.status === params.status)
    .filter((action) => !params.source || action.source === params.source)
    .filter((action) => !params.actionType || action.actionType === params.actionType)
    .filter((action) => !params.priority || action.priority === params.priority)
    .filter((action) => !params.dueDateKey || action.dueDateKey === params.dueDateKey)
    .filter((action) => !params.dueStartDateKey || (action.dueDateKey ?? action.dateKey) >= params.dueStartDateKey!)
    .filter((action) => !params.dueEndDateKey || (action.dueDateKey ?? action.dateKey) <= params.dueEndDateKey!)
    .filter((action) => !params.workflowState || action.workflowState === params.workflowState)
    .filter((action) => !params.visibilityState || action.visibilityState === params.visibilityState)
    .filter((action) => !params.assignedToUserId || action.assignedToUserId === params.assignedToUserId)
    .filter((action) => !params.lastContactResult || action.lastContactResult === params.lastContactResult)
    .filter((action) => params.includeHidden || action.visibilityState !== "hidden")
    .filter((action) => !params.queueView || actionMatchesQueueView(action, params.queueView))
    .filter((action) => params.includeResolved || Boolean(params.status) || Boolean(params.queueView) || !isActionResolved(action))
    .sort(
      (left, right) =>
        (left.dueDateKey ?? left.dateKey).localeCompare(right.dueDateKey ?? right.dateKey) ||
        right.priorityScore - left.priorityScore ||
        right.updatedAt.localeCompare(left.updatedAt),
    )
    .slice(0, limit);
}

export async function getAction(clinicId: string, actionId: string) {
  const snapshot = await actionCollection().doc(actionId).get();
  return requireAction(normalizeAction(snapshot.id, snapshot.data()), clinicId, actionId);
}

export async function upsertAction(action: AiRevenueAction) {
  const timestamp = nowIso();
  const nextAction: AiRevenueAction = {
    ...action,
    createdAt: action.createdAt || timestamp,
    updatedAt: timestamp,
  };

  await actionCollection().doc(nextAction.id).set(stripUndefinedDeep(nextAction) as Record<string, unknown>, { merge: true });
  return nextAction;
}

export async function updateActionStatus(params: {
  clinicId: string;
  actionId: string;
  status: AiRevenueActionStatus;
  updatedBy: AiRevenueActor | null;
}) {
  const current = await getAction(params.clinicId, params.actionId);
  const timestamp = nowIso();
  const nextAction: AiRevenueAction = {
    ...current,
    status: params.status,
    followUp: RESOLVED_STATUSES.has(params.status)
      ? {
          ...current.followUp,
          status: "completed",
          nextFollowUpDate: null,
          completedAt: current.followUp.completedAt ?? timestamp,
          completedBy: current.followUp.completedBy ?? params.updatedBy,
        }
      : current.followUp,
    lastStatusAt: timestamp,
    lastStatusBy: params.updatedBy,
    updatedAt: timestamp,
  };

  await actionCollection().doc(params.actionId).set(stripUndefinedDeep(nextAction) as Record<string, unknown>, { merge: true });
  return nextAction;
}

export async function updateActionResolution(params: {
  clinicId: string;
  actionId: string;
  status: AiRevenueActionStatus;
  resolution: AiRevenueActionResolution;
  updatedBy: AiRevenueActor | null;
}) {
  const current = await getAction(params.clinicId, params.actionId);
  const timestamp = nowIso();
  const nextAction: AiRevenueAction = {
    ...current,
    status: params.status,
    resolution: params.resolution,
    followUp: {
      ...current.followUp,
      status: params.resolution.suppressCustomer ? "suppressed" : "completed",
      nextFollowUpDate: null,
      completedAt: params.resolution.resolvedAt,
      completedBy: params.resolution.resolvedBy,
      suppressedAt: params.resolution.suppressCustomer ? params.resolution.resolvedAt : current.followUp.suppressedAt,
      suppressionId: params.resolution.suppressionId ?? current.followUp.suppressionId ?? null,
      lastResult:
        params.resolution.reason === "wrong_number"
          ? "wrong_number"
          : params.resolution.reason === "do_not_contact"
            ? "do_not_contact"
            : params.resolution.reason === "not_interested"
              ? "not_interested"
              : current.followUp.lastResult,
      lastNote: params.resolution.note ?? current.followUp.lastNote ?? null,
      lastHandledBy: params.resolution.resolvedBy,
    },
    lastStatusAt: timestamp,
    lastStatusBy: params.updatedBy,
    updatedAt: timestamp,
  };

  await actionCollection().doc(params.actionId).set(stripUndefinedDeep(nextAction) as Record<string, unknown>, { merge: true });
  return nextAction;
}

export async function updateMessage(params: {
  clinicId: string;
  actionId: string;
  patch: Partial<AiRevenueMessageInfo>;
}) {
  const current = await getAction(params.clinicId, params.actionId);
  const timestamp = nowIso();
  const nextAction: AiRevenueAction = {
    ...current,
    message: {
      ...current.message,
      ...params.patch,
    },
    updatedAt: timestamp,
  };

  await actionCollection().doc(params.actionId).set(stripUndefinedDeep(nextAction) as Record<string, unknown>, { merge: true });
  return nextAction;
}

export async function updateAppointment(params: {
  clinicId: string;
  actionId: string;
  patch: Partial<AiRevenueAppointmentInfo>;
}) {
  const current = await getAction(params.clinicId, params.actionId);
  const timestamp = nowIso();
  const nextAction: AiRevenueAction = {
    ...current,
    appointment: {
      ...current.appointment,
      ...params.patch,
    },
    updatedAt: timestamp,
  };

  await actionCollection().doc(params.actionId).set(stripUndefinedDeep(nextAction) as Record<string, unknown>, { merge: true });
  return nextAction;
}

export async function updateRevenue(params: {
  clinicId: string;
  actionId: string;
  patch: Partial<AiRevenueRevenueInfo>;
}) {
  const current = await getAction(params.clinicId, params.actionId);
  const timestamp = nowIso();
  const nextAction: AiRevenueAction = {
    ...current,
    revenue: {
      ...current.revenue,
      ...params.patch,
    },
    updatedAt: timestamp,
  };

  await actionCollection().doc(params.actionId).set(stripUndefinedDeep(nextAction) as Record<string, unknown>, { merge: true });
  return nextAction;
}

export async function createMessageEvent(event: Omit<AiRevenueMessageEvent, "id" | "createdAt"> & {
  id?: string;
  createdAt?: string;
}) {
  const ref = event.id ? messageEventCollection().doc(event.id) : messageEventCollection().doc();
  const record: AiRevenueMessageEvent = {
    ...event,
    id: ref.id,
    createdAt: event.createdAt ?? nowIso(),
  };

  await ref.set(stripUndefinedDeep(record) as Record<string, unknown>, { merge: true });
  return record;
}

export async function createFollowUpAttempt(attempt: Omit<AiRevenueFollowUpAttempt, "id" | "createdAt"> & {
  id?: string;
  createdAt?: string;
}) {
  const ref = attempt.id ? followUpAttemptCollection().doc(attempt.id) : followUpAttemptCollection().doc();
  const record: AiRevenueFollowUpAttempt = {
    ...attempt,
    id: ref.id,
    createdAt: attempt.createdAt ?? nowIso(),
  };

  await ref.set(stripUndefinedDeep(record) as Record<string, unknown>, { merge: true });
  return record;
}

export async function updateFollowUp(params: {
  clinicId: string;
  actionId: string;
  patch: Partial<AiRevenueFollowUpInfo>;
}) {
  const current = await getAction(params.clinicId, params.actionId);
  const timestamp = nowIso();
  const nextAction: AiRevenueAction = {
    ...current,
    followUp: normalizeFollowUp(
      {
        ...current.followUp,
        ...params.patch,
        outcome: {
          ...current.followUp.outcome,
          ...params.patch.outcome,
        },
      },
      current.followUp,
    ),
    updatedAt: timestamp,
  };

  await actionCollection().doc(params.actionId).set(stripUndefinedDeep(nextAction) as Record<string, unknown>, { merge: true });
  return nextAction;
}

export async function updateActionFollowUpWorkflow(params: {
  clinicId: string;
  actionId: string;
  patch: Partial<AiRevenueAction>;
  actor: AiRevenueActor | null;
  auditDescription: string;
}) {
  const current = await getAction(params.clinicId, params.actionId);
  const timestamp = nowIso();
  const shouldUpdateStatusActor = Boolean(
    params.patch.status ||
      params.patch.workflowState ||
      params.patch.visibilityState ||
      params.patch.lastContactAt ||
      params.patch.lastContactResult ||
      params.patch.completedAt ||
      params.patch.closedAt ||
      params.patch.closedReason,
  );
  const nextAction: AiRevenueAction = {
    ...current,
    ...params.patch,
    customer: {
      ...current.customer,
      ...params.patch.customer,
    },
    service: {
      ...current.service,
      ...params.patch.service,
    },
    packageInfo: {
      ...current.packageInfo,
      ...params.patch.packageInfo,
    },
    appointment: {
      ...current.appointment,
      ...params.patch.appointment,
    },
    message: {
      ...current.message,
      ...params.patch.message,
    },
    revenue: {
      ...current.revenue,
      ...params.patch.revenue,
    },
    followUp: params.patch.followUp
      ? normalizeFollowUp(
          {
            ...current.followUp,
            ...params.patch.followUp,
            outcome: {
              ...current.followUp.outcome,
              ...params.patch.followUp.outcome,
            },
          },
          current.followUp,
        )
      : current.followUp,
    lastStatusAt: shouldUpdateStatusActor ? timestamp : current.lastStatusAt,
    lastStatusBy: shouldUpdateStatusActor ? params.actor : current.lastStatusBy,
    updatedAt: timestamp,
  };

  await actionCollection().doc(params.actionId).set(stripUndefinedDeep(nextAction) as Record<string, unknown>, { merge: true });
  await createAuditLog({
    clinicId: params.clinicId,
    actionId: params.actionId,
    actorType: "staff",
    actorId: params.actor?.userId ?? null,
    action: "follow_up_workflow_updated",
    description: params.auditDescription,
    beforeValue: {
      workflowState: current.workflowState,
      visibilityState: current.visibilityState,
      dueDateKey: current.dueDateKey,
      nextFollowUpAt: current.nextFollowUpAt,
      attemptCount: current.attemptCount,
      lastContactResult: current.lastContactResult,
    },
    afterValue: params.patch,
  });

  const snapshot = await actionCollection().doc(params.actionId).get();
  return requireAction(normalizeAction(snapshot.id, snapshot.data()), params.clinicId, params.actionId);
}

export async function createContactAttempt(input: Omit<AiRevenueContactAttempt, "id" | "createdAt"> & {
  id?: string;
  createdAt?: string;
}) {
  const createdAt = input.createdAt ?? nowIso();
  const id = input.id ?? `air_contact_${hashId([input.actionId, createdAt, input.result, input.channel].join("|"))}`;
  const record: AiRevenueContactAttempt = {
    ...input,
    id,
    channel: normalizeContactChannel(input.channel),
    result: normalizeContactResult(input.result),
    createdAt,
  };

  await contactAttemptCollection().doc(id).set(stripUndefinedDeep(record) as Record<string, unknown>, { merge: true });
  const snapshot = await contactAttemptCollection().doc(id).get();
  return normalizeContactAttempt(snapshot.id, snapshot.data()) ?? record;
}

export async function listContactAttempts(params: {
  clinicId: string;
  actionId?: string;
  agentUserId?: string;
  startDateKey?: string;
  endDateKey?: string;
  limit?: number;
}) {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  // MVP filters by clinicId in memory. Recommended indexes for scale:
  // gt_ai_revenue_contact_attempts: clinicId ASC + actionId ASC + createdAt DESC
  // gt_ai_revenue_contact_attempts: clinicId ASC + agentUserId ASC + createdAt DESC
  const snapshot = await contactAttemptCollection().where("clinicId", "==", params.clinicId).limit(500).get();

  return snapshot.docs
    .map((doc) => normalizeContactAttempt(doc.id, doc.data()))
    .filter((attempt): attempt is AiRevenueContactAttempt => Boolean(attempt))
    .filter((attempt) => !params.actionId || attempt.actionId === params.actionId)
    .filter((attempt) => !params.agentUserId || attempt.agentUserId === params.agentUserId)
    .filter((attempt) => {
      const createdDateKey = dateKeyFromIso(attempt.createdAt);
      if (params.startDateKey && (!createdDateKey || createdDateKey < params.startDateKey)) {
        return false;
      }
      if (params.endDateKey && (!createdDateKey || createdDateKey > params.endDateKey)) {
        return false;
      }
      return true;
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
}

export async function createCustomerTimelineEvent(input: Omit<AiRevenueCustomerTimelineEvent, "id" | "createdAt" | "eventType"> & {
  eventType?: "service_follow_up";
  id?: string;
  createdAt?: string;
}) {
  const createdAt = input.createdAt ?? nowIso();
  const id = input.id ?? `air_timeline_${hashId([input.actionId, input.contactAttemptId, createdAt].join("|"))}`;
  const record: AiRevenueCustomerTimelineEvent = {
    ...input,
    id,
    eventType: "service_follow_up",
    channel: normalizeContactChannel(input.channel),
    result: normalizeContactResult(input.result),
    createdAt,
  };

  await customerTimelineEventCollection().doc(id).set(stripUndefinedDeep(record) as Record<string, unknown>, { merge: true });
  const snapshot = await customerTimelineEventCollection().doc(id).get();
  return normalizeCustomerTimelineEvent(snapshot.id, snapshot.data()) ?? record;
}

export async function listCustomerTimelineEvents(params: {
  clinicId: string;
  actionId?: string;
  customerKey?: string;
  memberId?: string;
  phoneHash?: string;
  limit?: number;
}) {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  // Recommended index for scale: clinicId ASC, createdAt DESC.
  // Optional drilldown indexes: clinicId ASC + actionId/customerKey/memberId/phoneHash ASC + createdAt DESC.
  const snapshot = await customerTimelineEventCollection().where("clinicId", "==", params.clinicId).limit(500).get();

  return snapshot.docs
    .map((doc) => normalizeCustomerTimelineEvent(doc.id, doc.data()))
    .filter((event): event is AiRevenueCustomerTimelineEvent => Boolean(event))
    .filter((event) => !params.actionId || event.actionId === params.actionId)
    .filter((event) => !params.customerKey || event.customerKey === params.customerKey)
    .filter((event) => !params.memberId || event.memberId === params.memberId)
    .filter((event) => !params.phoneHash || event.phoneHash === params.phoneHash)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
}

export async function createOutcomeLink(input: Omit<AiRevenueOutcomeLink, "id" | "createdAt"> & {
  id?: string;
  createdAt?: string;
}) {
  const createdAt = input.createdAt ?? nowIso();
  const id =
    input.id ??
    `air_outcome_${hashId([input.actionId, input.outcomeType, input.eventAt, input.bookingId, input.invoiceNumber].join("|"))}`;
  const record: AiRevenueOutcomeLink = {
    ...input,
    id,
    outcomeType: normalizeOutcomeType(input.outcomeType),
    attributionType: normalizeAttributionType(input.attributionType),
    createdAt,
  };

  await outcomeLinkCollection().doc(id).set(stripUndefinedDeep(record) as Record<string, unknown>, { merge: true });
  const snapshot = await outcomeLinkCollection().doc(id).get();
  return normalizeOutcomeLink(snapshot.id, snapshot.data()) ?? record;
}

export async function listOutcomeLinks(params: {
  clinicId: string;
  actionId?: string;
  outcomeType?: AiRevenueOutcomeType;
  startDateKey?: string;
  endDateKey?: string;
  limit?: number;
}) {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  // MVP filters by clinicId in memory. Recommended indexes for scale:
  // gt_ai_revenue_outcome_links: clinicId ASC + actionId ASC + eventAt DESC
  // gt_ai_revenue_outcome_links: clinicId ASC + outcomeType ASC + eventAt DESC
  const snapshot = await outcomeLinkCollection().where("clinicId", "==", params.clinicId).limit(500).get();

  return snapshot.docs
    .map((doc) => normalizeOutcomeLink(doc.id, doc.data()))
    .filter((link): link is AiRevenueOutcomeLink => Boolean(link))
    .filter((link) => !params.actionId || link.actionId === params.actionId)
    .filter((link) => !params.outcomeType || link.outcomeType === params.outcomeType)
    .filter((link) => {
      const eventDateKey = dateKeyFromIso(link.eventAt);
      if (params.startDateKey && (!eventDateKey || eventDateKey < params.startDateKey)) {
        return false;
      }
      if (params.endDateKey && (!eventDateKey || eventDateKey > params.endDateKey)) {
        return false;
      }
      return true;
    })
    .sort((left, right) => right.eventAt.localeCompare(left.eventAt))
    .slice(0, limit);
}

export async function saveAppointmentOutcome(outcome: Omit<AiRevenueAppointmentOutcome, "id" | "updatedAt"> & {
  id?: string;
  updatedAt?: string;
}) {
  const id = outcome.id ?? outcome.actionId;
  const record: AiRevenueAppointmentOutcome = {
    ...outcome,
    id,
    updatedAt: outcome.updatedAt ?? nowIso(),
  };

  await appointmentOutcomeCollection().doc(id).set(stripUndefinedDeep(record) as Record<string, unknown>, { merge: true });
  return record;
}

export async function createAuditLog(log: Omit<AiRevenueAuditLog, "id" | "createdAt"> & {
  id?: string;
  createdAt?: string;
}) {
  const ref = log.id ? auditLogCollection().doc(log.id) : auditLogCollection().doc();
  const record: AiRevenueAuditLog = {
    ...log,
    id: ref.id,
    createdAt: log.createdAt ?? nowIso(),
  };

  await ref.set(stripUndefinedDeep(record) as Record<string, unknown>, { merge: true });
  return record;
}

function normalizeAuditLog(id: string, data: FirebaseFirestore.DocumentData | undefined): AiRevenueAuditLog | null {
  if (!data || typeof data.clinicId !== "string") {
    return null;
  }

  return {
    id,
    actionId: nullableText(data.actionId),
    clinicId: data.clinicId,
    actorType:
      data.actorType === "ai" || data.actorType === "staff" || data.actorType === "customer" || data.actorType === "system"
        ? data.actorType
        : "system",
    actorId: nullableText(data.actorId),
    action: cleanText(data.action),
    description: cleanText(data.description),
    beforeValue: data.beforeValue,
    afterValue: data.afterValue,
    createdAt: cleanText(data.createdAt, nowIso()),
  };
}

export async function listAuditLogs(params: {
  clinicId: string;
  actionId?: string;
  actorType?: AiRevenueAuditActorType;
  limit?: number;
}) {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  const snapshot = params.actionId
    ? await auditLogCollection().where("actionId", "==", params.actionId).limit(limit).get()
    : await auditLogCollection().where("clinicId", "==", params.clinicId).limit(limit).get();

  return snapshot.docs
    .map((doc) => normalizeAuditLog(doc.id, doc.data()))
    .filter((log): log is AiRevenueAuditLog => Boolean(log))
    .filter((log) => log.clinicId === params.clinicId)
    .filter((log) => !params.actionId || log.actionId === params.actionId)
    .filter((log) => !params.actorType || log.actorType === params.actorType)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function normalizeSuppressionReason(value: unknown): AiRevenueResolutionReason {
  return aiRevenueResolutionReasons.includes(value as AiRevenueResolutionReason)
    ? (value as AiRevenueResolutionReason)
    : "other";
}

function normalizeSuppressionScope(value: unknown): AiRevenueSuppressionScope {
  return aiRevenueSuppressionScopes.includes(value as AiRevenueSuppressionScope)
    ? (value as AiRevenueSuppressionScope)
    : "customer";
}

function normalizeCustomerSuppression(
  id: string,
  data: FirebaseFirestore.DocumentData | undefined,
): AiRevenueCustomerSuppression | null {
  if (!data || typeof data.clinicId !== "string") {
    return null;
  }

  return {
    id,
    clinicId: data.clinicId,
    customerKey: nullableText(data.customerKey),
    memberId: nullableText(data.memberId),
    phoneHash: nullableText(data.phoneHash),
    customerName: nullableText(data.customerName),
    serviceId: nullableText(data.serviceId),
    serviceName: nullableText(data.serviceName),
    channel: nullableText(data.channel),
    permanent: typeof data.permanent === "boolean" ? data.permanent : undefined,
    reason: normalizeSuppressionReason(data.reason),
    scope: normalizeSuppressionScope(data.scope),
    sourceActionId: nullableText(data.sourceActionId),
    sourceAttemptId: nullableText(data.sourceAttemptId),
    active: typeof data.active === "boolean" ? data.active : true,
    suppressUntil: nullableText(data.suppressUntil),
    note: nullableText(data.note),
    createdAt: cleanText(data.createdAt, nowIso()),
    createdBy: normalizeActor(data.createdBy),
    liftedAt: nullableText(data.liftedAt),
    liftedBy: normalizeActor(data.liftedBy),
  };
}

export function isSuppressionActive(suppression: AiRevenueCustomerSuppression, dateKey?: string) {
  if (!suppression.active) {
    return false;
  }
  if (!suppression.suppressUntil) {
    return true;
  }
  return !dateKey || suppression.suppressUntil >= dateKey;
}

export function isActionResolved(action: AiRevenueAction) {
  return Boolean(action.resolution || RESOLVED_STATUSES.has(action.status));
}

export function customerMatchesSuppression(customer: AiRevenueCustomer, suppression: AiRevenueCustomerSuppression) {
  if (suppression.scope === "phone_only") {
    const candidatePhoneHash = phoneHash(customer.phoneNumber);
    return Boolean(candidatePhoneHash && suppression.phoneHash && candidatePhoneHash === suppression.phoneHash);
  }

  if (suppression.memberId && customer.memberId && suppression.memberId === customer.memberId) {
    return true;
  }

  const candidateCustomerKey = strongCustomerKey(customer.customerKey);
  if (suppression.customerKey && candidateCustomerKey && suppression.customerKey === candidateCustomerKey) {
    return true;
  }

  const candidatePhoneHash = phoneHash(customer.phoneNumber);
  return Boolean(candidatePhoneHash && suppression.phoneHash && candidatePhoneHash === suppression.phoneHash);
}

function normalizeMatchText(value: unknown) {
  return cleanText(value).toLowerCase().replace(/\s+/g, " ");
}

function serviceMatchesSuppression(service: AiRevenueServiceInfo | undefined, suppression: AiRevenueCustomerSuppression) {
  if (suppression.scope !== "service") {
    return true;
  }

  const suppressionServiceId = normalizeMatchText(suppression.serviceId);
  const serviceId = normalizeMatchText(service?.serviceId);
  if (suppressionServiceId && serviceId) {
    return suppressionServiceId === serviceId;
  }

  const suppressionServiceName = normalizeMatchText(suppression.serviceName);
  const serviceName = normalizeMatchText(service?.serviceName);
  if (!suppressionServiceName) {
    return true;
  }

  return Boolean(
    serviceName &&
      (serviceName === suppressionServiceName ||
        serviceName.includes(suppressionServiceName) ||
        suppressionServiceName.includes(serviceName)),
  );
}

function channelMatchesSuppression(channel: string | null | undefined, suppression: AiRevenueCustomerSuppression) {
  if (suppression.scope !== "channel") {
    return true;
  }

  const suppressionChannel = normalizeMatchText(suppression.channel);
  if (!suppressionChannel) {
    return true;
  }

  return normalizeMatchText(channel) === suppressionChannel;
}

export function opportunityMatchesSuppression(
  input: {
    customer: AiRevenueCustomer;
    service?: AiRevenueServiceInfo;
    channel?: string | null;
  },
  suppression: AiRevenueCustomerSuppression,
) {
  if (!customerMatchesSuppression(input.customer, suppression)) {
    return false;
  }

  return serviceMatchesSuppression(input.service, suppression) && channelMatchesSuppression(input.channel, suppression);
}

export function isCustomerSuppressed(
  customer: AiRevenueCustomer,
  suppressions: AiRevenueCustomerSuppression[],
  dateKey?: string,
) {
  return suppressions.some(
    (suppression) => isSuppressionActive(suppression, dateKey) && customerMatchesSuppression(customer, suppression),
  );
}

export function isOpportunitySuppressed(
  input: {
    customer: AiRevenueCustomer;
    service?: AiRevenueServiceInfo;
    channel?: string | null;
  },
  suppressions: AiRevenueCustomerSuppression[],
  dateKey?: string,
) {
  return suppressions.some(
    (suppression) => isSuppressionActive(suppression, dateKey) && opportunityMatchesSuppression(input, suppression),
  );
}

export async function createCustomerSuppression(input: {
  clinicId: string;
  customer: AiRevenueCustomer;
  service?: AiRevenueServiceInfo | null;
  channel?: string | null;
  reason: AiRevenueResolutionReason;
  scope: AiRevenueSuppressionScope;
  sourceActionId?: string | null;
  sourceAttemptId?: string | null;
  permanent?: boolean;
  suppressUntil?: string | null;
  note?: string | null;
  createdBy: AiRevenueActor | null;
}) {
  const memberId = nullableText(input.customer.memberId);
  const customerKey = strongCustomerKey(input.customer.customerKey);
  const hashedPhone = phoneHash(input.customer.phoneNumber);
  const baseIdentityKey = memberId || customerKey || hashedPhone;
  const serviceId = nullableText(input.service?.serviceId);
  const serviceName = nullableText(input.service?.serviceName);
  const channel = nullableText(input.channel);
  const identityKey =
    input.scope === "phone_only"
      ? hashedPhone
      : input.scope === "service"
        ? baseIdentityKey
          ? [baseIdentityKey, serviceId || serviceName || "all_services"].join("|")
          : null
        : input.scope === "channel"
          ? baseIdentityKey
            ? [baseIdentityKey, channel || "all_channels"].join("|")
            : null
          : baseIdentityKey;
  if (!identityKey) {
    throw new HttpError(400, "A customer identifier or phone number is required before suppressing future AI Revenue opportunities.");
  }

  const id = `air_supp_${hashId([input.clinicId, input.scope, identityKey, input.reason].join("|"))}`;
  const record: AiRevenueCustomerSuppression = {
    id,
    clinicId: input.clinicId,
    customerKey,
    memberId,
    phoneHash: hashedPhone,
    customerName: nullableText(input.customer.customerName),
    serviceId,
    serviceName,
    channel,
    permanent: input.permanent,
    reason: input.reason,
    scope: input.scope,
    sourceActionId: input.sourceActionId ?? null,
    sourceAttemptId: input.sourceAttemptId ?? null,
    active: true,
    suppressUntil: input.suppressUntil ?? null,
    note: input.note ?? null,
    createdAt: nowIso(),
    createdBy: input.createdBy,
    liftedAt: null,
    liftedBy: null,
  };

  await customerSuppressionCollection().doc(id).set(stripUndefinedDeep(record) as Record<string, unknown>, { merge: true });
  return record;
}

export async function listCustomerSuppressions(params: {
  clinicId: string;
  includeInactive?: boolean;
  limit?: number;
}) {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  const snapshot = await customerSuppressionCollection().where("clinicId", "==", params.clinicId).limit(500).get();
  return snapshot.docs
    .map((doc) => normalizeCustomerSuppression(doc.id, doc.data()))
    .filter((suppression): suppression is AiRevenueCustomerSuppression => Boolean(suppression))
    .filter((suppression) => params.includeInactive || suppression.active)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
}

export async function listActiveCustomerSuppressions(params: {
  clinicId: string;
  dateKey?: string;
}) {
  const suppressions = await listCustomerSuppressions({
    clinicId: params.clinicId,
    includeInactive: false,
    limit: 500,
  });
  return suppressions.filter((suppression) => isSuppressionActive(suppression, params.dateKey));
}

export async function liftCustomerSuppression(params: {
  clinicId: string;
  suppressionId: string;
  liftedBy: AiRevenueActor | null;
}) {
  const currentSnapshot = await customerSuppressionCollection().doc(params.suppressionId).get();
  const current = normalizeCustomerSuppression(currentSnapshot.id, currentSnapshot.data());
  if (!current || current.clinicId !== params.clinicId) {
    throw new HttpError(404, `AI Revenue customer suppression ${params.suppressionId} was not found.`);
  }

  const next: AiRevenueCustomerSuppression = {
    ...current,
    active: false,
    liftedAt: nowIso(),
    liftedBy: params.liftedBy,
  };

  await customerSuppressionCollection().doc(params.suppressionId).set(stripUndefinedDeep(next) as Record<string, unknown>, { merge: true });
  return next;
}

export async function getSummary(params: {
  clinicId: string;
  startDateKey?: string;
  endDateKey?: string;
  status?: AiRevenueActionStatus;
  source?: AiRevenueActionSource;
  actionType?: AiRevenueActionType;
  priority?: AiRevenuePriority;
}) {
  const actions = await listActions({
    clinicId: params.clinicId,
    limit: 500,
    includeResolved: true,
  });

  const allFiltered = actions.filter((action) => {
    if (params.startDateKey && action.dateKey < params.startDateKey) {
      return false;
    }
    if (params.endDateKey && action.dateKey > params.endDateKey) {
      return false;
    }
    if (params.status && action.status !== params.status) {
      return false;
    }
    if (params.source && action.source !== params.source) {
      return false;
    }
    if (params.actionType && action.actionType !== params.actionType) {
      return false;
    }
    if (params.priority && action.priority !== params.priority) {
      return false;
    }
    return true;
  });
  const filtered = params.status ? allFiltered : allFiltered.filter((action) => !isActionResolved(action));

  const countStatus = (...statuses: AiRevenueActionStatus[]) => {
    const statusSet = new Set(statuses);
    return filtered.filter((action) => statusSet.has(action.status)).length;
  };
  const resolvedActions = allFiltered.filter(isActionResolved).length;
  const suppressedActions = allFiltered.filter((action) => action.resolution?.suppressCustomer || action.visibilityState === "suppressed").length;
  const followUpOpen = allFiltered.filter((action) => action.followUp.status === "open").length;
  const followUpCompleted = allFiltered.filter((action) => action.followUp.status === "completed").length;
  const followUpSuppressed = allFiltered.filter((action) => action.followUp.status === "suppressed").length;
  const followUpAttempts = allFiltered.reduce((sum, action) => sum + numberOrZero(action.followUp.attemptCount), 0);
  const followUpInterested = allFiltered.filter((action) => action.followUp.lastResult === "interested").length;
  const followUpBooked = allFiltered.filter((action) =>
    Boolean(
      action.followUp.outcome.appointmentBookingId ||
        action.followUp.lastResult === "appointment_booked" ||
        action.followUp.lastResult === "already_booked",
    ),
  ).length;
  const followUpRepurchased = allFiltered.filter((action) =>
    Boolean(
      numberOrZero(action.followUp.outcome.repurchaseRevenue) > 0 ||
        numberOrZero(action.revenue.actualRevenue) > 0 ||
        numberOrZero(action.revenue.influencedRevenue) > 0,
    ),
  ).length;
  const today = todayDateKey();
  const contactedToday = allFiltered.filter(
    (action) => dateKeyFromIso(action.lastContactAt) === today || dateKeyFromIso(action.followUp.lastContactedAt) === today,
  ).length;
  const completedToday = allFiltered.filter(
    (action) =>
      dateKeyFromIso(action.completedAt) === today ||
      dateKeyFromIso(action.followUp.completedAt) === today ||
      (action.visibilityState === "completed" && dateKeyFromIso(action.lastStatusAt) === today),
  ).length;
  const scheduledFollowUps = allFiltered.filter(
    (action) => action.visibilityState === "scheduled" || action.workflowState === "scheduled_follow_up",
  ).length;
  const appointmentBookedFromFollowUp = allFiltered.filter((action) =>
    Boolean(
      action.workflowState === "appointment_booked" ||
        action.lastContactResult === "appointment_booked" ||
        action.lastContactResult === "already_booked" ||
        action.followUp.outcome.appointmentBookingId,
    ),
  ).length;
  const repurchasesAttributed = allFiltered.filter((action) =>
    Boolean(
      numberOrZero(action.followUp.outcome.repurchaseRevenue) > 0 ||
        numberOrZero(action.revenue.actualRevenue) > 0 ||
        numberOrZero(action.revenue.influencedRevenue) > 0,
    ),
  ).length;
  const sourceBreakdown = {
    serviceReminder: filtered.filter((action) => action.actionType === "service_reminder_follow_up" || action.actionType === "service_reminder_overdue").length,
    unusedPackage: filtered.filter((action) => action.actionType === "unused_package_follow_up" || action.actionType === "package_upsell_opportunity").length,
    appointmentReminder: filtered.filter((action) => action.actionType === "appointment_confirmation_reminder").length,
    noShowRecovery: filtered.filter((action) => action.actionType === "no_show_recovery").length,
    cancelledRecovery: filtered.filter((action) => action.actionType === "cancelled_appointment_recovery").length,
    inactiveVip: filtered.filter((action) => action.actionType === "inactive_vip_recovery").length,
    birthdayFollowUp: filtered.filter((action) => action.actionType === "birthday_follow_up").length,
    other: filtered.filter((action) => action.actionType === "payment_follow_up").length,
  };

  return {
    totalActions: allFiltered.length,
    opportunitiesFound: filtered.length,
    activeOpportunities: filtered.length,
    resolvedActions,
    suppressedActions,
    highPriority: filtered.filter((action) => action.priority === "high").length,
    draftsReady: countStatus("draft_ready"),
    pendingApproval: countStatus("pending_approval"),
    approvedMessages: countStatus("approved"),
    messagesSent: countStatus("sent"),
    customersReplied: filtered.filter((action) =>
      Boolean(
        action.message.lastInboundAt ||
          action.message.lastInboundText ||
          ["customer_replied", "human_takeover", "not_interested"].includes(action.status),
      ),
    ).length,
    appointmentsRequested: countStatus("appointment_requested"),
    appointmentsCreated: countStatus("appointment_created", "appointment_confirmed", "reminder_sent", "customer_came", "completed", "revenue_attributed"),
    remindersSent: filtered.filter((action) => action.status === "reminder_sent" || Boolean(action.appointment.reminderSentAt)).length,
    customersCame: countStatus("customer_came", "completed", "revenue_attributed"),
    completed: countStatus("completed", "revenue_attributed"),
    cancelled: countStatus("cancelled"),
    noShow: countStatus("no_show"),
    followUpOpen,
    followUpCompleted,
    followUpSuppressed,
    followUpAttempts,
    followUpInterested,
    followUpBooked,
    followUpRepurchased,
    followUpsDueToday: allFiltered.filter((action) => actionMatchesQueueView(action, "today", today)).length,
    followUpsOverdue: allFiltered.filter((action) => actionMatchesQueueView(action, "overdue", today)).length,
    contactedToday,
    completedToday,
    scheduledFollowUps,
    appointmentBookedFromFollowUp,
    repurchasesAttributed,
    aiGeneratedRevenue: filtered.reduce((sum, action) => sum + numberOrZero(action.revenue.actualRevenue), 0),
    aiInfluencedRevenue: filtered.reduce((sum, action) => sum + numberOrZero(action.revenue.influencedRevenue), 0),
    packageSessionsRecovered: filtered.reduce((sum, action) => sum + numberOrZero(action.revenue.packageSessionsRecovered), 0),
    sourceBreakdown,
    currency: "MMK",
  } satisfies AiRevenueSummary;
}

export function buildDefaultSettings(clinicId: string): AiRevenueSettings {
  return {
    clinicId,
    clinicCode: null,
    clinicName: null,
    aiRevenueAgentEnabled: false,
    autoGenerateTodayOpportunities: false,
    timezone: "Asia/Yangon",
    dailyGenerateTime: "06:00",
    runOrder: 0,
    language: "my-MM",
    messagingMode: "manual",
    approvalRequired: true,
    attributionWindowDays: 30,
    maxActionsPerRun: 50,
    lastAutoGeneratedAt: null,
    lastAutoGenerateStatus: null,
    updatedAt: null,
    updatedBy: null,
  };
}

function normalizeSettings(clinicId: string, data: FirebaseFirestore.DocumentData | undefined): AiRevenueSettings {
  const defaults = buildDefaultSettings(clinicId);
  if (!data) {
    return defaults;
  }

  return {
    clinicId,
    clinicCode: nullableText(data.clinicCode),
    clinicName: nullableText(data.clinicName),
    aiRevenueAgentEnabled: data.aiRevenueAgentEnabled === true,
    autoGenerateTodayOpportunities: data.autoGenerateTodayOpportunities === true,
    timezone: cleanText(data.timezone, defaults.timezone),
    dailyGenerateTime: /^\d{2}:\d{2}$/.test(cleanText(data.dailyGenerateTime))
      ? cleanText(data.dailyGenerateTime)
      : defaults.dailyGenerateTime,
    runOrder: Math.max(0, Math.round(numberOrZero(data.runOrder))),
    language: data.language === "en-US" ? "en-US" : "my-MM",
    messagingMode: data.messagingMode === "mock" || data.messagingMode === "provider" ? data.messagingMode : "manual",
    approvalRequired: typeof data.approvalRequired === "boolean" ? data.approvalRequired : true,
    attributionWindowDays: Math.min(365, Math.max(1, Math.round(numberOrZero(data.attributionWindowDays) || defaults.attributionWindowDays))),
    maxActionsPerRun: Math.min(500, Math.max(1, Math.round(numberOrZero(data.maxActionsPerRun) || defaults.maxActionsPerRun))),
    lastAutoGeneratedAt: nullableText(data.lastAutoGeneratedAt),
    lastAutoGenerateStatus: nullableText(data.lastAutoGenerateStatus),
    updatedAt: nullableText(data.updatedAt),
    updatedBy: normalizeActor(data.updatedBy),
  };
}

export async function getSettings(clinicId: string) {
  const snapshot = await settingsCollection().doc(clinicId).get();
  return normalizeSettings(clinicId, snapshot.data());
}

export async function saveSettings(input: {
  clinicId: string;
  patch: Partial<AiRevenueSettings>;
  updatedBy: AiRevenueActor | null;
}) {
  const current = await getSettings(input.clinicId);
  const next: AiRevenueSettings = normalizeSettings(input.clinicId, {
    ...current,
    ...input.patch,
    updatedAt: nowIso(),
    updatedBy: input.updatedBy,
  });

  await settingsCollection().doc(input.clinicId).set(stripUndefinedDeep(next) as Record<string, unknown>, { merge: true });
  return next;
}

export async function listAutoGenerateEnabledSettings(params?: { limit?: number }) {
  const limit = Math.min(Math.max(params?.limit ?? 500, 1), 1_000);
  const snapshot = await settingsCollection()
    .where("aiRevenueAgentEnabled", "==", true)
    .where("autoGenerateTodayOpportunities", "==", true)
    .limit(limit)
    .get();

  return snapshot.docs
    .map((doc) => normalizeSettings(doc.id, doc.data()))
    .filter((settings) => settings.aiRevenueAgentEnabled && settings.autoGenerateTodayOpportunities)
    .sort(
      (left, right) =>
        left.runOrder - right.runOrder ||
        (left.clinicName ?? left.clinicId).localeCompare(right.clinicName ?? right.clinicId),
    );
}

export async function updateSettingsAutoGenerationStatus(params: {
  clinicId: string;
  status: string;
  generatedAt?: string | null;
}) {
  await settingsCollection().doc(params.clinicId).set(
    stripUndefinedDeep({
      lastAutoGeneratedAt: params.generatedAt ?? nowIso(),
      lastAutoGenerateStatus: params.status,
      updatedAt: nowIso(),
    }) as Record<string, unknown>,
    { merge: true },
  );
}

function aiRevenueRunSummaryId(params: { clinicId: string; dateKey: string }) {
  return `${encodeURIComponent(params.clinicId)}__${params.dateKey}`;
}

function normalizeAiRevenueRunSummary(
  id: string,
  data: FirebaseFirestore.DocumentData | undefined,
): AiRevenueRunSummaryRecord | null {
  if (!data || typeof data.clinicId !== "string" || typeof data.dateKey !== "string") {
    return null;
  }

  return {
    id,
    clinicId: data.clinicId,
    clinicCode: nullableText(data.clinicCode),
    dateKey: data.dateKey,
    status: "completed",
    generatedCount: Math.max(0, Math.round(numberOrZero(data.generatedCount))),
    skippedExistingCount: Math.max(0, Math.round(numberOrZero(data.skippedExistingCount))),
    refreshedExistingCount: Math.max(0, Math.round(numberOrZero(data.refreshedExistingCount))),
    actionCount: Math.max(0, Math.round(numberOrZero(data.actionCount))),
    sourceStatus:
      data.sourceStatus && typeof data.sourceStatus === "object"
        ? (data.sourceStatus as Record<string, unknown>)
        : {},
    createdAt: cleanText(data.createdAt, nowIso()),
    updatedAt: cleanText(data.updatedAt, nowIso()),
  };
}

export async function saveAiRevenueRunSummary(input: {
  clinicId: string;
  clinicCode?: string | null;
  dateKey: string;
  generatedCount: number;
  skippedExistingCount: number;
  refreshedExistingCount: number;
  actionCount: number;
  sourceStatus: Record<string, unknown>;
}) {
  const id = aiRevenueRunSummaryId(input);
  const ref = aiRevenueRunCollection().doc(id);
  const snapshot = await ref.get();
  const current = normalizeAiRevenueRunSummary(snapshot.id, snapshot.data());
  const timestamp = nowIso();
  const record: AiRevenueRunSummaryRecord = {
    id,
    clinicId: input.clinicId,
    clinicCode: input.clinicCode ?? current?.clinicCode ?? null,
    dateKey: input.dateKey,
    status: "completed",
    generatedCount: Math.max(0, Math.round(numberOrZero(input.generatedCount))),
    skippedExistingCount: Math.max(0, Math.round(numberOrZero(input.skippedExistingCount))),
    refreshedExistingCount: Math.max(0, Math.round(numberOrZero(input.refreshedExistingCount))),
    actionCount: Math.max(0, Math.round(numberOrZero(input.actionCount))),
    sourceStatus: input.sourceStatus ?? {},
    createdAt: current?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };

  await ref.set(stripUndefinedDeep(record) as Record<string, unknown>, { merge: true });
  return record;
}

export async function getAiRevenueRunSummary(params: { clinicId: string; dateKey: string }) {
  const id = aiRevenueRunSummaryId(params);
  const snapshot = await aiRevenueRunCollection().doc(id).get();
  return normalizeAiRevenueRunSummary(snapshot.id, snapshot.data());
}

function scheduledRunId(parts: string[]) {
  return parts.map((part) => encodeURIComponent(part)).join("_");
}

function scheduledErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";
}

function normalizeClinicRunRecord(
  id: string,
  data: FirebaseFirestore.DocumentData | undefined,
): AiRevenueClinicRunRecord | null {
  if (!data || typeof data.jobName !== "string" || typeof data.clinicId !== "string" || typeof data.dateKey !== "string") {
    return null;
  }

  const status = ["running", "completed", "skipped", "failed"].includes(data.status)
    ? (data.status as AiRevenueScheduledRunStatus)
    : "failed";

  return {
    id,
    jobName: data.jobName,
    clinicId: data.clinicId,
    clinicCode: nullableText(data.clinicCode),
    clinicName: nullableText(data.clinicName),
    dateKey: data.dateKey,
    timezone: cleanText(data.timezone, "Asia/Yangon"),
    status,
    startedAt: cleanText(data.startedAt, nowIso()),
    completedAt: nullableText(data.completedAt),
    lockExpiresAt: nullableText(data.lockExpiresAt),
    createdCount: Math.max(0, Math.round(numberOrZero(data.createdCount))),
    duplicateSkippedCount: Math.max(0, Math.round(numberOrZero(data.duplicateSkippedCount))),
    suppressedSkippedCount: Math.max(0, Math.round(numberOrZero(data.suppressedSkippedCount))),
    errorMessage: nullableText(data.errorMessage),
  };
}

export function aiRevenueBatchRunId(params: { jobName: string; dateKey: string }) {
  return scheduledRunId([params.jobName, params.dateKey]);
}

export function aiRevenueClinicRunId(params: { jobName: string; dateKey: string; clinicId: string }) {
  return scheduledRunId([params.jobName, params.dateKey, params.clinicId]);
}

export async function saveAiRevenueBatchRun(params: {
  jobName: string;
  dateKey: string;
  timezone: string;
  status: AiRevenueScheduledRunStatus;
  startedAt?: string;
  completedAt?: string | null;
  summary?: Partial<AiRevenueBatchRunSummary>;
  error?: unknown;
}) {
  const id = aiRevenueBatchRunId(params);
  await batchRunCollection().doc(id).set(
    stripUndefinedDeep({
      id,
      jobName: params.jobName,
      dateKey: params.dateKey,
      timezone: params.timezone,
      status: params.status,
      startedAt: params.startedAt ?? nowIso(),
      completedAt: params.completedAt ?? null,
      totalClinics: params.summary?.totalClinics ?? 0,
      dueClinics: params.summary?.dueClinics ?? 0,
      processedClinics: params.summary?.processedClinics ?? 0,
      skippedClinics: params.summary?.skippedClinics ?? 0,
      failedClinics: params.summary?.failedClinics ?? 0,
      totalCreated: params.summary?.totalCreated ?? 0,
      totalDuplicateSkipped: params.summary?.totalDuplicateSkipped ?? 0,
      totalSuppressedSkipped: params.summary?.totalSuppressedSkipped ?? 0,
      dryRun: params.summary?.dryRun ?? false,
      skippedReason: params.summary?.skippedReason ?? null,
      errorMessage: params.error ? scheduledErrorMessage(params.error) : null,
      updatedAt: nowIso(),
    }) as Record<string, unknown>,
    { merge: true },
  );
}

export async function getAiRevenueClinicRun(params: {
  jobName: string;
  clinicId: string;
  dateKey: string;
}) {
  const id = aiRevenueClinicRunId(params);
  const snapshot = await clinicRunCollection().doc(id).get();
  return normalizeClinicRunRecord(snapshot.id, snapshot.data());
}

export async function acquireAiRevenueClinicRunLock(params: {
  jobName: string;
  clinicId: string;
  clinicCode?: string | null;
  clinicName?: string | null;
  dateKey: string;
  timezone: string;
  leaseMs?: number;
}): Promise<{
  acquired: boolean;
  reason?: "completed" | "lock_active";
  record: AiRevenueClinicRunRecord | null;
}> {
  const db = firestoreDb();
  const id = aiRevenueClinicRunId(params);
  const ref = clinicRunCollection().doc(id);
  const now = Date.now();
  const startedAt = nowIso();
  const lockExpiresAt = new Date(now + (params.leaseMs ?? 45 * 60_000)).toISOString();

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const record = normalizeClinicRunRecord(snapshot.id, snapshot.data());
    const existingExpiresAt = record?.lockExpiresAt ? new Date(record.lockExpiresAt).getTime() : 0;

    if (record?.status === "completed") {
      return { acquired: false, reason: "completed" as const, record };
    }

    if (record?.status === "running" && existingExpiresAt > now) {
      return { acquired: false, reason: "lock_active" as const, record };
    }

    const nextRecord = {
      id,
      jobName: params.jobName,
      clinicId: params.clinicId,
      clinicCode: params.clinicCode ?? record?.clinicCode ?? null,
      clinicName: params.clinicName ?? record?.clinicName ?? null,
      dateKey: params.dateKey,
      timezone: params.timezone,
      status: "running",
      startedAt,
      completedAt: null,
      lockExpiresAt,
      createdCount: 0,
      duplicateSkippedCount: 0,
      suppressedSkippedCount: 0,
      errorMessage: null,
      updatedAt: startedAt,
    };
    transaction.set(ref, stripUndefinedDeep(nextRecord) as Record<string, unknown>, { merge: true });

    return {
      acquired: true,
      record: normalizeClinicRunRecord(id, nextRecord),
    };
  });
}

export async function completeAiRevenueClinicRun(params: {
  jobName: string;
  clinicId: string;
  clinicCode?: string | null;
  clinicName?: string | null;
  dateKey: string;
  timezone: string;
  status: AiRevenueScheduledRunStatus;
  createdCount?: number;
  duplicateSkippedCount?: number;
  suppressedSkippedCount?: number;
  error?: unknown;
}) {
  const id = aiRevenueClinicRunId(params);
  const completedAt = nowIso();
  await clinicRunCollection().doc(id).set(
    stripUndefinedDeep({
      id,
      jobName: params.jobName,
      clinicId: params.clinicId,
      clinicCode: params.clinicCode ?? null,
      clinicName: params.clinicName ?? null,
      dateKey: params.dateKey,
      timezone: params.timezone,
      status: params.status,
      completedAt,
      lockExpiresAt: null,
      createdCount: params.createdCount ?? 0,
      duplicateSkippedCount: params.duplicateSkippedCount ?? 0,
      suppressedSkippedCount: params.suppressedSkippedCount ?? 0,
      errorMessage: params.error ? scheduledErrorMessage(params.error) : null,
      updatedAt: completedAt,
    }) as Record<string, unknown>,
    { merge: true },
  );
}
