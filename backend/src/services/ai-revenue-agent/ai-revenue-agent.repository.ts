import { firestoreDb } from "../../config/firebase.js";
import { HttpError } from "../../utils/http-error.js";
import {
  aiRevenueActionSources,
  aiRevenueActionStatuses,
  aiRevenueActionTypes,
  aiRevenueAttributionTypes,
  type AiRevenueAction,
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
} from "../../types/ai-revenue-agent.js";

const ACTIONS_COLLECTION = "gt_ai_revenue_actions";
const MESSAGE_EVENTS_COLLECTION = "gt_ai_revenue_message_events";
const APPOINTMENT_OUTCOMES_COLLECTION = "gt_ai_revenue_appointment_outcomes";
const AUDIT_LOGS_COLLECTION = "gt_ai_revenue_audit_logs";
const SETTINGS_COLLECTION = "gt_ai_revenue_settings";

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

function cleanText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nullableText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
  });

  const filtered = actions.filter((action) => {
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

  const countStatus = (...statuses: AiRevenueActionStatus[]) => {
    const statusSet = new Set(statuses);
    return filtered.filter((action) => statusSet.has(action.status)).length;
  };

  return {
    totalActions: filtered.length,
    opportunitiesFound: filtered.length,
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
