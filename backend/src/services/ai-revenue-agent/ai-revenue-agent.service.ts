import type { SessionUser } from "../../types/auth.js";
import type {
  AiRevenueActionStatus,
  AiRevenueAppointmentInfo,
  AiRevenueAuditActorType,
  AiRevenueMessageInfo,
  AiRevenueRevenueInfo,
  AiRevenueSettings,
} from "../../types/ai-revenue-agent.js";
import { HttpError } from "../../utils/http-error.js";
import { fetchApicoreBookingDetails, type ApicoreBookingDetailsRow } from "../apicore.service.js";
import {
  apicoreBookingWallClockDateKey,
  buildApicoreBookingDetailsDateRange,
} from "../apicore-booking-details-range.js";
import * as repository from "./ai-revenue-agent.repository.js";
import {
  buildAiAppointmentReminderMessage,
  type AiAppointmentReminderTemplateType,
} from "./appointment-reminder-template.service.js";
import { buildAiRevenueMessageDraft } from "./message-template.service.js";
import { generateAiRevenueOpportunities } from "./opportunity-generator.service.js";
import {
  recordManualAiRevenue,
  syncAiRevenueAttribution,
} from "./revenue-attribution.service.js";

export type AiRevenueAppointmentUpdateType =
  | "appointment_confirmed"
  | "reminder_sent"
  | "customer_came"
  | "cancelled"
  | "no_show"
  | "completed";

const APICORE_SYNC_PAGE_SIZE = 200;
const APICORE_SYNC_MAX_ROWS = 1000;

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

function normalizeBookingStatus(value: unknown) {
  return cleanText(value).toUpperCase().replace(/[\s-]+/g, "_");
}

function sameBookingId(left: unknown, right: unknown) {
  return cleanText(left).toLowerCase() === cleanText(right).toLowerCase();
}

function statusToBookingStatus(status?: AiRevenueActionStatus) {
  switch (status) {
    case "appointment_created":
      return "BOOKED";
    case "appointment_confirmed":
      return "CONFIRMED";
    case "customer_came":
      return "CHECKIN";
    case "cancelled":
      return "CANCELLED";
    case "no_show":
      return "NO_SHOW";
    case "completed":
      return "CHECKOUT";
    default:
      return null;
  }
}

function bookingStatusToActionStatus(status: unknown): AiRevenueActionStatus | null {
  switch (normalizeBookingStatus(status)) {
    case "BOOKED":
    case "REQUEST":
      return "appointment_created";
    case "CHECKIN":
    case "CHECKED_IN":
      return "customer_came";
    case "CHECKOUT":
    case "CHECKED_OUT":
    case "COMPLETED":
      return "completed";
    case "MEMBER_CANCEL":
    case "MERCHANT_CANCEL":
    case "CANCEL":
    case "CANCELLED":
      return "cancelled";
    case "NO_SHOW":
    case "NOSHOW":
      return "no_show";
    default:
      return null;
  }
}

function appointmentStatusPatchDefaults(
  patch: Partial<AiRevenueAppointmentInfo>,
  status: AiRevenueActionStatus | undefined,
  timestamp: string,
) {
  const nextPatch: Partial<AiRevenueAppointmentInfo> = { ...patch };
  const bookingStatus = statusToBookingStatus(status);

  if (bookingStatus && nextPatch.bookingStatus == null) {
    nextPatch.bookingStatus = bookingStatus;
  }

  switch (status) {
    case "reminder_sent":
      nextPatch.reminderSentAt = nextPatch.reminderSentAt ?? timestamp;
      break;
    case "customer_came":
      nextPatch.cameAt = nextPatch.cameAt ?? timestamp;
      break;
    case "cancelled":
      nextPatch.cancelledAt = nextPatch.cancelledAt ?? timestamp;
      break;
    case "no_show":
      nextPatch.noShowAt = nextPatch.noShowAt ?? timestamp;
      break;
    case "completed":
      nextPatch.completedAt = nextPatch.completedAt ?? timestamp;
      break;
    default:
      break;
  }

  return nextPatch;
}

function dateKeyForSync(value?: string | null) {
  return apicoreBookingWallClockDateKey(value) ?? (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
}

async function fetchBookingRowsForSync(input: {
  clinicCode: string;
  dateKey: string;
  authorizationHeader?: string;
}) {
  const rows: ApicoreBookingDetailsRow[] = [];
  const range = buildApicoreBookingDetailsDateRange({
    fromDate: input.dateKey,
    toDate: input.dateKey,
  });
  let skip = 0;
  let totalCount = Number.POSITIVE_INFINITY;

  while (skip < totalCount && rows.length < APICORE_SYNC_MAX_ROWS) {
    const result = await fetchApicoreBookingDetails({
      clinicCode: input.clinicCode,
      startDate: range.startIso,
      endDate: range.endIso,
      skip,
      take: APICORE_SYNC_PAGE_SIZE,
      authorizationHeader: input.authorizationHeader,
      readOnly: true,
    });

    rows.push(...result.data);
    totalCount = result.totalCount;
    if (result.data.length === 0) {
      break;
    }
    skip += APICORE_SYNC_PAGE_SIZE;
  }

  return rows;
}

function bookingRowToAppointmentPatch(row: ApicoreBookingDetailsRow, timestamp: string): Partial<AiRevenueAppointmentInfo> {
  const mappedStatus = bookingStatusToActionStatus(row.status);
  const patch: Partial<AiRevenueAppointmentInfo> = {
    bookingId: row.bookingid,
    appointmentDateTime: row.FromTime,
    bookingStatus: normalizeBookingStatus(row.status) || row.status,
    serviceName: cleanText(row.ServiceName) || null,
    practitionerName: cleanText(row.PractitionerName) || null,
  };

  switch (mappedStatus) {
    case "customer_came":
      patch.cameAt = timestamp;
      break;
    case "cancelled":
      patch.cancelledAt = timestamp;
      break;
    case "no_show":
      patch.noShowAt = timestamp;
      break;
    case "completed":
      patch.completedAt = timestamp;
      break;
    default:
      break;
  }

  return patch;
}

function appointmentAuditAction(status?: AiRevenueActionStatus) {
  switch (status) {
    case "appointment_created":
      return "appointment_created";
    case "appointment_confirmed":
      return "appointment_confirmed";
    case "reminder_sent":
      return "reminder_sent";
    case "customer_came":
      return "customer_came";
    case "cancelled":
      return "appointment_cancelled";
    case "no_show":
      return "appointment_no_show";
    case "completed":
      return "appointment_completed";
    default:
      return "appointment_updated";
  }
}

function appointmentAuditDescription(status?: AiRevenueActionStatus) {
  switch (status) {
    case "appointment_created":
      return "AI Revenue appointment booking ID linked.";
    case "appointment_confirmed":
      return "AI Revenue appointment marked confirmed.";
    case "reminder_sent":
      return "AI Revenue appointment reminder marked sent.";
    case "customer_came":
      return "AI Revenue appointment marked customer came.";
    case "cancelled":
      return "AI Revenue appointment marked cancelled.";
    case "no_show":
      return "AI Revenue appointment marked no-show.";
    case "completed":
      return "AI Revenue appointment marked completed.";
    default:
      return "AI Revenue appointment information updated.";
  }
}

export function getActorFromUser(user: SessionUser | undefined) {
  return actorFromUser(user);
}

async function createStatusSideEffectAudit(input: {
  clinicId: string;
  actionId: string;
  status?: AiRevenueActionStatus;
  user?: SessionUser;
  existingAuditAction: string;
}) {
  if (input.status === "human_takeover" && input.existingAuditAction !== "human_takeover") {
    await repository.createAuditLog({
      clinicId: input.clinicId,
      actionId: input.actionId,
      actorType: "staff",
      actorId: input.user?.userId ?? input.user?.uid ?? null,
      action: "human_takeover",
      description: "AI Revenue action moved to human takeover.",
      afterValue: { status: input.status },
    });
  }

  if (input.status === "closed" && input.existingAuditAction !== "action_closed") {
    await repository.createAuditLog({
      clinicId: input.clinicId,
      actionId: input.actionId,
      actorType: "staff",
      actorId: input.user?.userId ?? input.user?.uid ?? null,
      action: "action_closed",
      description: "AI Revenue action closed.",
      afterValue: { status: input.status },
    });
  }
}

export async function listAiRevenueActions(input: Parameters<typeof repository.listActions>[0]) {
  const actions = await repository.listActions(input);
  const summary = await repository.getSummary({
    clinicId: input.clinicId,
    startDateKey: input.dateKey,
    endDateKey: input.dateKey,
  });

  return { actions, summary };
}

export async function getAiRevenueAction(input: { clinicId: string; actionId: string }) {
  return repository.getAction(input.clinicId, input.actionId);
}

export async function generateAiRevenueActions(input: {
  clinicId: string;
  clinicCode: string;
  dateKey?: string;
  forceRefresh?: boolean;
  authorizationHeader?: string;
}) {
  const dateKey = input.dateKey ?? new Date().toISOString().slice(0, 10);
  const generated = await generateAiRevenueOpportunities({
    clinicId: input.clinicId,
    clinicCode: input.clinicCode,
    dateKey,
    forceRefresh: input.forceRefresh,
    authorizationHeader: input.authorizationHeader,
  });
  const summary = await repository.getSummary({
    clinicId: input.clinicId,
    startDateKey: dateKey,
    endDateKey: dateKey,
  });

  return {
    dateKey,
    generatedCount: generated.generatedCount,
    skippedExistingCount: generated.skippedExistingCount,
    actions: generated.actions,
    sourceStatus: generated.sourceStatus,
    summary,
  };
}

export async function updateAiRevenueStatus(input: {
  clinicId: string;
  actionId: string;
  status: AiRevenueActionStatus;
  user?: SessionUser;
  auditAction: string;
  auditDescription: string;
}) {
  const action = await repository.updateActionStatus({
    clinicId: input.clinicId,
    actionId: input.actionId,
    status: input.status,
    updatedBy: actorFromUser(input.user),
  });
  await repository.createAuditLog({
    clinicId: input.clinicId,
    actionId: input.actionId,
    actorType: "staff",
    actorId: input.user?.userId ?? input.user?.uid ?? null,
    action: input.auditAction,
    description: input.auditDescription,
    afterValue: { status: input.status },
  });
  await createStatusSideEffectAudit({
    clinicId: input.clinicId,
    actionId: input.actionId,
    status: input.status,
    user: input.user,
    existingAuditAction: input.auditAction,
  });

  return action;
}

export async function generateAiRevenueMessage(input: {
  clinicId: string;
  actionId: string;
  draftText?: string | null;
  user?: SessionUser;
}) {
  const current = await repository.getAction(input.clinicId, input.actionId);
  const staffEdited = typeof input.draftText === "string" && input.draftText.trim().length > 0;
  const draftText = staffEdited ? input.draftText!.trim() : buildAiRevenueMessageDraft(current);
  const action = await repository.updateMessage({
    clinicId: input.clinicId,
    actionId: input.actionId,
    patch: {
      draftText,
    },
  });
  const nextAction = await repository.updateActionStatus({
    clinicId: input.clinicId,
    actionId: input.actionId,
    status: "draft_ready",
    updatedBy: actorFromUser(input.user),
  });
  await repository.createAuditLog({
    clinicId: input.clinicId,
    actionId: input.actionId,
    actorType: staffEdited ? "staff" : "ai",
    actorId: staffEdited ? (input.user?.userId ?? input.user?.uid ?? null) : "ai_revenue_agent",
    action: staffEdited ? "message_edited" : "message_drafted",
    description: staffEdited
      ? "Staff edited AI Revenue Agent message draft."
      : "AI Revenue Agent deterministic draft message prepared for staff approval.",
    afterValue: { draftText: action.message.draftText },
  });

  return nextAction;
}

export async function approveAiRevenueMessage(input: {
  clinicId: string;
  actionId: string;
  approvedText: string;
  user?: SessionUser;
}) {
  const actor = actorFromUser(input.user);
  const action = await repository.updateMessage({
    clinicId: input.clinicId,
    actionId: input.actionId,
    patch: {
      approvedText: input.approvedText,
      approvedBy: actor,
      approvedAt: nowIso(),
    },
  });
  const nextAction = await repository.updateActionStatus({
    clinicId: input.clinicId,
    actionId: input.actionId,
    status: "approved",
    updatedBy: actor,
  });
  await repository.createAuditLog({
    clinicId: input.clinicId,
    actionId: input.actionId,
    actorType: "staff",
    actorId: input.user?.userId ?? input.user?.uid ?? null,
    action: "message_approved",
    description: "Staff approved AI Revenue Agent message.",
    afterValue: { approvedText: action.message.approvedText },
  });

  return nextAction;
}

export async function updateAiRevenueMessage(input: {
  clinicId: string;
  actionId: string;
  patch: Partial<AiRevenueMessageInfo>;
  status?: AiRevenueActionStatus;
  user?: SessionUser;
  auditAction: string;
  auditDescription: string;
}) {
  const action = await repository.updateMessage({
    clinicId: input.clinicId,
    actionId: input.actionId,
    patch: input.patch,
  });
  const nextAction = input.status
    ? await repository.updateActionStatus({
        clinicId: input.clinicId,
        actionId: input.actionId,
        status: input.status,
        updatedBy: actorFromUser(input.user),
      })
    : action;
  await repository.createAuditLog({
    clinicId: input.clinicId,
    actionId: input.actionId,
    actorType: "staff",
    actorId: input.user?.userId ?? input.user?.uid ?? null,
    action: input.auditAction,
    description: input.auditDescription,
    afterValue: input.patch,
  });
  await createStatusSideEffectAudit({
    clinicId: input.clinicId,
    actionId: input.actionId,
    status: input.status,
    user: input.user,
    existingAuditAction: input.auditAction,
  });

  return nextAction;
}

export async function createAiRevenueMessageEvent(input: {
  clinicId: string;
  actionId: string;
  memberId?: string | null;
  channel: string;
  direction: "outbound" | "inbound";
  messageText: string;
  intent?: string | null;
  confidence?: number | null;
  providerMessageId?: string | null;
  createdAt?: string;
  user?: SessionUser;
}) {
  return repository.createMessageEvent({
    clinicId: input.clinicId,
    actionId: input.actionId,
    memberId: input.memberId,
    channel: input.channel,
    direction: input.direction,
    messageText: input.messageText,
    intent: input.intent,
    confidence: input.confidence,
    providerMessageId: input.providerMessageId,
    createdAt: input.createdAt,
    createdBy: actorFromUser(input.user),
  });
}

export async function updateAiRevenueAppointment(input: {
  clinicId: string;
  actionId: string;
  patch: Partial<AiRevenueAppointmentInfo>;
  status?: AiRevenueActionStatus;
  reminderTemplateType?: AiAppointmentReminderTemplateType;
  user?: SessionUser;
}) {
  const timestamp = nowIso();
  const patch = appointmentStatusPatchDefaults(input.patch, input.status, timestamp);
  const action = await repository.updateAppointment({
    clinicId: input.clinicId,
    actionId: input.actionId,
    patch,
  });
  const nextAction = input.status
    ? await repository.updateActionStatus({
        clinicId: input.clinicId,
        actionId: input.actionId,
        status: input.status,
        updatedBy: actorFromUser(input.user),
      })
    : action;

  if (input.status === "reminder_sent") {
    await repository.createMessageEvent({
      clinicId: input.clinicId,
      actionId: input.actionId,
      memberId: nextAction.customer.memberId ?? null,
      channel: "manual",
      direction: "outbound",
      messageText: buildAiAppointmentReminderMessage(nextAction, input.reminderTemplateType),
      intent: "appointment_reminder",
      confidence: 1,
      providerMessageId: null,
      createdAt: patch.reminderSentAt ?? timestamp,
      createdBy: actorFromUser(input.user),
    });
  }

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
    actorType: "staff",
    actorId: input.user?.userId ?? input.user?.uid ?? null,
    action: appointmentAuditAction(input.status),
    description: appointmentAuditDescription(input.status),
    afterValue: patch,
  });

  return nextAction;
}

export async function syncAiRevenueAppointmentOutcome(input: {
  clinicId: string;
  actionId: string;
  authorizationHeader?: string;
  user?: SessionUser;
}) {
  const current = await repository.getAction(input.clinicId, input.actionId);
  const clinicCode = cleanText(current.clinicCode);
  const bookingId = cleanText(current.appointment.bookingId);
  if (!bookingId) {
    throw new HttpError(400, "Booking ID is required before syncing appointment outcome.");
  }
  if (!clinicCode) {
    throw new HttpError(400, "Clinic code is required before syncing appointment outcome.");
  }

  const syncDateKey =
    dateKeyForSync(current.appointment.appointmentDateTime) ??
    dateKeyForSync(current.dateKey) ??
    new Date().toISOString().slice(0, 10);
  const rows = await fetchBookingRowsForSync({
    clinicCode,
    dateKey: syncDateKey,
    authorizationHeader: input.authorizationHeader,
  });
  const booking = rows.find((row) => sameBookingId(row.bookingid, bookingId));
  if (!booking) {
    throw new HttpError(404, `Booking ${bookingId} was not found in APICORE appointment data for ${syncDateKey}.`);
  }

  const timestamp = nowIso();
  const mappedStatus = bookingStatusToActionStatus(booking.status);
  const action = await updateAiRevenueAppointment({
    clinicId: input.clinicId,
    actionId: input.actionId,
    status: mappedStatus ?? undefined,
    user: input.user,
    patch: bookingRowToAppointmentPatch(booking, timestamp),
  });

  await repository.createAuditLog({
    clinicId: input.clinicId,
    actionId: input.actionId,
    actorType: "system",
    actorId: "apicore_booking_details",
    action: "appointment_synced",
    description: mappedStatus
      ? `Synced APICORE booking status ${normalizeBookingStatus(booking.status)}.`
      : `Synced APICORE booking status ${booking.status || "unknown"} without lifecycle mapping.`,
    beforeValue: {
      bookingId: current.appointment.bookingId,
      bookingStatus: current.appointment.bookingStatus,
      status: current.status,
    },
    afterValue: {
      bookingId: booking.bookingid,
      bookingStatus: booking.status,
      status: mappedStatus ?? action.status,
      appointmentDateTime: booking.FromTime,
    },
  });

  return action;
}

export async function requestAiRevenueBooking(input: {
  clinicId: string;
  actionId: string;
  requestedDateTime?: string | null;
  serviceId?: string | null;
  serviceName?: string | null;
  practitionerId?: string | null;
  practitionerName?: string | null;
  note?: string | null;
  mode?: "direct_booking" | "booking_request";
  user?: SessionUser;
}) {
  const current = await repository.getAction(input.clinicId, input.actionId);
  const timestamp = nowIso();
  const actor = actorFromUser(input.user);
  const requestedMode = input.mode ?? "booking_request";
  const effectiveMode = "booking_request";
  const attributionNote = [
    "Created/requested by GT V2 AI Revenue Agent",
    `AI_ACTION_ID: ${input.actionId}`,
    `Source: ${current.actionType}`,
    `Reason: ${current.reason}`,
  ].join("\n");

  const nextAction = await repository.upsertAction({
    ...current,
    service: {
      ...current.service,
      serviceId: input.serviceId ?? current.service.serviceId ?? null,
      serviceName: input.serviceName ?? current.service.serviceName ?? null,
    },
    appointment: {
      ...current.appointment,
      appointmentDateTime: input.requestedDateTime ?? current.appointment.appointmentDateTime ?? null,
      bookingStatus: "REQUESTED",
      requestMode: effectiveMode,
      serviceId: input.serviceId ?? current.service.serviceId ?? null,
      serviceName: input.serviceName ?? current.service.serviceName ?? null,
      practitionerId: input.practitionerId ?? current.appointment.practitionerId ?? null,
      practitionerName: input.practitionerName ?? current.appointment.practitionerName ?? null,
      note: input.note ?? null,
      attributionNote,
      requestedAt: timestamp,
    },
    status: "appointment_requested",
    lastStatusAt: timestamp,
    lastStatusBy: actor,
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
    actorType: "staff",
    actorId: input.user?.userId ?? input.user?.uid ?? null,
    action: "appointment_requested",
    description:
      requestedMode === "direct_booking"
        ? "Direct booking is not enabled in GT V2 yet; appointment request stored for staff processing."
        : "AI Revenue appointment request stored for staff processing.",
    afterValue: {
      requestedDateTime: input.requestedDateTime ?? null,
      serviceId: input.serviceId ?? null,
      serviceName: input.serviceName ?? null,
      practitionerId: input.practitionerId ?? null,
      practitionerName: input.practitionerName ?? null,
      note: input.note ?? null,
      mode: effectiveMode,
      requestedMode,
      attributionNote,
    },
  });

  return nextAction;
}

export async function updateAiRevenueRevenue(input: {
  clinicId: string;
  actionId: string;
  patch: Partial<AiRevenueRevenueInfo>;
  user?: SessionUser;
}) {
  return recordManualAiRevenue(input);
}

export async function syncAiRevenueRevenue(input: {
  clinicId: string;
  actionId: string;
  clinicCode?: string | null;
  attributionWindowDays?: number;
  authorizationHeader?: string;
  user?: SessionUser;
}) {
  return syncAiRevenueAttribution(input);
}

export async function listAiRevenueAuditLogs(input: Parameters<typeof repository.listAuditLogs>[0]) {
  return repository.listAuditLogs(input);
}

export async function getAiRevenueSummary(input: Parameters<typeof repository.getSummary>[0]) {
  return repository.getSummary(input);
}

export async function getAiRevenueSettings(clinicId: string) {
  return repository.getSettings(clinicId);
}

export async function saveAiRevenueSettings(input: {
  clinicId: string;
  patch: Partial<AiRevenueSettings>;
  user?: SessionUser;
}) {
  return repository.saveSettings({
    clinicId: input.clinicId,
    patch: input.patch,
    updatedBy: actorFromUser(input.user),
  });
}

export async function createAiRevenueAuditLog(input: {
  clinicId: string;
  actionId?: string | null;
  actorType: AiRevenueAuditActorType;
  actorId?: string | null;
  action: string;
  description: string;
  beforeValue?: unknown;
  afterValue?: unknown;
}) {
  return repository.createAuditLog(input);
}
