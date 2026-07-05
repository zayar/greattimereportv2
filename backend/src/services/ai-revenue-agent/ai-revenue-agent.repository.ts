import { createHash } from "node:crypto";
import { firestoreDb } from "../../config/firebase.js";
import { HttpError } from "../../utils/http-error.js";
import {
  aiRevenueActionSources,
  aiRevenueActionStatuses,
  aiRevenueActionTypes,
  aiRevenueAttributionTypes,
  aiRevenueResolutionReasons,
  aiRevenueSuppressionScopes,
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
  type AiRevenueMessageEvent,
  type AiRevenueMessageInfo,
  type AiRevenueRevenueInfo,
  type AiRevenueSettings,
  type AiRevenueSummary,
  type AiRevenueActor,
  type AiRevenueCustomer,
  type AiRevenueCustomerSuppression,
  type AiRevenueResolutionReason,
  type AiRevenueSuppressionScope,
} from "../../types/ai-revenue-agent.js";

const ACTIONS_COLLECTION = "gt_ai_revenue_actions";
const MESSAGE_EVENTS_COLLECTION = "gt_ai_revenue_message_events";
const APPOINTMENT_OUTCOMES_COLLECTION = "gt_ai_revenue_appointment_outcomes";
const AUDIT_LOGS_COLLECTION = "gt_ai_revenue_audit_logs";
const SETTINGS_COLLECTION = "gt_ai_revenue_settings";
const CUSTOMER_SUPPRESSIONS_COLLECTION = "gt_ai_revenue_customer_suppressions";
const RESOLVED_STATUSES = new Set<AiRevenueActionStatus>(["closed", "skipped", "not_interested"]);

function nowIso() {
  return new Date().toISOString();
}

function actionCollection() {
  return firestoreDb().collection(ACTIONS_COLLECTION);
}

function messageEventCollection() {
  return firestoreDb().collection(MESSAGE_EVENTS_COLLECTION);
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

  const customer = data.customer && typeof data.customer === "object" ? (data.customer as Record<string, unknown>) : {};
  const service = data.service && typeof data.service === "object" ? (data.service as Record<string, unknown>) : {};
  const packageInfo = data.packageInfo && typeof data.packageInfo === "object" ? (data.packageInfo as Record<string, unknown>) : {};

  return {
    id,
    clinicId: data.clinicId,
    clinicCode: nullableText(data.clinicCode),
    dateKey: cleanText(data.dateKey, new Date().toISOString().slice(0, 10)),
    source,
    sourceRefId: nullableText(data.sourceRefId),
    actionType,
    priority: data.priority === "high" || data.priority === "medium" || data.priority === "low" ? data.priority : "low",
    priorityScore: numberOrZero(data.priorityScore),
    title: cleanText(data.title, "AI Revenue action"),
    summary: cleanText(data.summary),
    reason: cleanText(data.reason),
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
    customer: {
      customerKey: nullableText(customer.customerKey),
      memberId: nullableText(customer.memberId),
      customerName: nullableText(customer.customerName),
      phoneNumber: nullableText(customer.phoneNumber),
      phoneMasked: nullableText(customer.phoneMasked),
    },
    service: {
      serviceId: nullableText(service.serviceId),
      serviceName: nullableText(service.serviceName),
      lastVisitDate: nullableText(service.lastVisitDate),
      reminderDate: nullableText(service.reminderDate),
    },
    packageInfo: {
      packageId: nullableText(packageInfo.packageId),
      packageName: nullableText(packageInfo.packageName),
      remainingUnits: numberOrNull(packageInfo.remainingUnits),
      purchasedUnits: numberOrNull(packageInfo.purchasedUnits),
      usedUnits: numberOrNull(packageInfo.usedUnits),
      lastUsedAt: nullableText(packageInfo.lastUsedAt),
    },
    appointment: normalizeAppointment(data.appointment),
    message: normalizeMessage(data.message),
    revenue: normalizeRevenue(data.revenue),
    status,
    createdAt: cleanText(data.createdAt, nowIso()),
    updatedAt: cleanText(data.updatedAt, nowIso()),
    createdBy: normalizeActor(data.createdBy),
    lastStatusAt: nullableText(data.lastStatusAt),
    lastStatusBy: normalizeActor(data.lastStatusBy),
    resolution: normalizeResolution(data.resolution),
  };
}

function requireAction(action: AiRevenueAction | null, clinicId: string, actionId: string) {
  if (!action || action.clinicId !== clinicId) {
    throw new HttpError(404, `AI Revenue action ${actionId} was not found.`);
  }

  return action;
}

export async function listActions(params: {
  clinicId: string;
  dateKey?: string;
  status?: AiRevenueActionStatus;
  source?: AiRevenueActionSource;
  actionType?: AiRevenueActionType;
  priority?: AiRevenuePriority;
  limit?: number;
  includeResolved?: boolean;
}) {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  const fetchLimit = Math.min(Math.max(limit * 5, limit), 500);
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
    .filter((action) => params.includeResolved || Boolean(params.status) || !isActionResolved(action))
    .sort((left, right) => right.priorityScore - left.priorityScore || right.updatedAt.localeCompare(left.updatedAt))
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
    reason: normalizeSuppressionReason(data.reason),
    scope: normalizeSuppressionScope(data.scope),
    sourceActionId: nullableText(data.sourceActionId),
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

export function isCustomerSuppressed(
  customer: AiRevenueCustomer,
  suppressions: AiRevenueCustomerSuppression[],
  dateKey?: string,
) {
  return suppressions.some(
    (suppression) => isSuppressionActive(suppression, dateKey) && customerMatchesSuppression(customer, suppression),
  );
}

export async function createCustomerSuppression(input: {
  clinicId: string;
  customer: AiRevenueCustomer;
  reason: AiRevenueResolutionReason;
  scope: AiRevenueSuppressionScope;
  sourceActionId?: string | null;
  suppressUntil?: string | null;
  note?: string | null;
  createdBy: AiRevenueActor | null;
}) {
  const memberId = nullableText(input.customer.memberId);
  const customerKey = strongCustomerKey(input.customer.customerKey);
  const hashedPhone = phoneHash(input.customer.phoneNumber);
  const identityKey = input.scope === "phone_only" ? hashedPhone : memberId || customerKey || hashedPhone;
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
    reason: input.reason,
    scope: input.scope,
    sourceActionId: input.sourceActionId ?? null,
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
  const suppressedActions = allFiltered.filter((action) => action.resolution?.suppressCustomer).length;
  const sourceBreakdown = {
    serviceReminder: filtered.filter((action) => action.actionType === "service_reminder_follow_up" || action.actionType === "service_reminder_overdue").length,
    unusedPackage: filtered.filter((action) => action.actionType === "unused_package_follow_up" || action.actionType === "package_upsell_opportunity").length,
    appointmentReminder: filtered.filter((action) => action.actionType === "appointment_confirmation_reminder").length,
    noShowRecovery: filtered.filter((action) => action.actionType === "no_show_recovery").length,
    cancelledRecovery: filtered.filter((action) => action.actionType === "cancelled_appointment_recovery").length,
    inactiveVip: filtered.filter((action) => action.actionType === "inactive_vip_recovery").length,
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
    language: "my-MM",
    messagingMode: "manual",
    approvalRequired: true,
    attributionWindowDays: 30,
    maxActionsPerRun: 50,
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
    language: data.language === "en-US" ? "en-US" : "my-MM",
    messagingMode: data.messagingMode === "mock" || data.messagingMode === "provider" ? data.messagingMode : "manual",
    approvalRequired: typeof data.approvalRequired === "boolean" ? data.approvalRequired : true,
    attributionWindowDays: Math.min(365, Math.max(1, Math.round(numberOrZero(data.attributionWindowDays) || defaults.attributionWindowDays))),
    maxActionsPerRun: Math.min(500, Math.max(1, Math.round(numberOrZero(data.maxActionsPerRun) || defaults.maxActionsPerRun))),
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
