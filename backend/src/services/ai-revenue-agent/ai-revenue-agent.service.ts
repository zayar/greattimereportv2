import type { SessionUser } from "../../types/auth.js";
import type {
  AiRevenueAction,
  AiRevenueActionStatus,
  AiRevenueAppointmentInfo,
  AiRevenueActor,
  AiRevenueAuditActorType,
  AiRevenueAttributionType,
  AiRevenueContactAttempt,
  AiRevenueContactChannel,
  AiRevenueContactResult,
  AiRevenueCustomerSuppression,
  AiRevenueCustomerTimelineEvent,
  AiRevenueFollowUpAttempt,
  AiRevenueFollowUpChannel,
  AiRevenueFollowUpOutcomeInfo,
  AiRevenueFollowUpResult,
  AiRevenueFollowUpScheduleOption,
  AiRevenueMessageInfo,
  AiRevenueOutcomeLink,
  AiRevenueOutcomeType,
  AiRevenueRevenueInfo,
  AiRevenueResolutionReason,
  AiRevenueSettings,
  AiRevenueSuppressionScope,
  AiRevenueVisibilityState,
  AiRevenueWorkflowState,
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

function dateKeyFromIso(value: string) {
  return value.slice(0, 10);
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateKeyFromMaybeIso(value?: string | null) {
  if (!value) {
    return null;
  }

  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function nextFollowUpDateForSchedule(input: {
  scheduleOption: AiRevenueFollowUpScheduleOption;
  contactedAt: string;
  customDate?: string | null;
}) {
  const contactedDateKey = dateKeyFromMaybeIso(input.contactedAt) ?? dateKeyFromIso(nowIso());

  switch (input.scheduleOption) {
    case "tomorrow":
      return addDays(contactedDateKey, 1);
    case "three_days":
      return addDays(contactedDateKey, 3);
    case "one_week":
      return addDays(contactedDateKey, 7);
    case "next_month":
      return addDays(contactedDateKey, 30);
    case "custom":
      return input.customDate ?? null;
    case "none":
    default:
      return null;
  }
}

function resultResolutionReason(result: AiRevenueFollowUpResult): AiRevenueResolutionReason | null {
  switch (result) {
    case "not_interested":
      return "not_interested";
    case "wrong_number":
      return "wrong_number";
    case "do_not_contact":
      return "do_not_contact";
    default:
      return null;
  }
}

function isTerminalFollowUpResult(result: AiRevenueFollowUpResult) {
  return [
    "appointment_booked",
    "already_booked",
    "already_visited",
    "not_interested",
    "wrong_number",
    "do_not_contact",
    "completed",
  ].includes(result);
}

function statusForFollowUpResult(input: {
  result: AiRevenueFollowUpResult;
  bookingId?: string | null;
  treatmentCompletedAt?: string | null;
}): AiRevenueActionStatus | null {
  switch (input.result) {
    case "interested":
      return "customer_replied";
    case "appointment_booked":
    case "already_booked":
      return cleanText(input.bookingId) ? "appointment_created" : "appointment_requested";
    case "already_visited":
      return input.treatmentCompletedAt ? "completed" : "customer_came";
    case "not_interested":
      return "not_interested";
    case "wrong_number":
    case "do_not_contact":
    case "completed":
      return "closed";
    case "no_answer":
    case "call_later":
    case "other":
      return "human_takeover";
    default:
      return null;
  }
}

function defaultSuppressionScopeForFollowUp(result: AiRevenueFollowUpResult): AiRevenueSuppressionScope {
  return result === "wrong_number" ? "phone_only" : "customer";
}

function resultLabel(result: AiRevenueFollowUpResult) {
  switch (result) {
    case "no_answer":
      return "No answer";
    case "call_later":
      return "Call later";
    case "interested":
      return "Interested";
    case "appointment_booked":
      return "Appointment booked";
    case "already_booked":
      return "Already booked";
    case "already_visited":
      return "Already visited";
    case "not_interested":
      return "Not interested";
    case "wrong_number":
      return "Wrong number";
    case "do_not_contact":
      return "Do not contact";
    case "completed":
      return "Completed";
    default:
      return "Other";
  }
}

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export interface AiRevenueFollowUpAppointmentInput {
  bookingId?: string | null;
  appointmentDateTime?: string | null;
  serviceId?: string | null;
  serviceName?: string | null;
  practitionerId?: string | null;
  practitionerName?: string | null;
  note?: string | null;
}

export interface AiRevenueFollowUpOutcomeInput {
  outcomeType?: AiRevenueOutcomeType;
  bookingId?: string | null;
  treatmentId?: string | null;
  orderId?: string | null;
  invoiceNumber?: string | null;
  serviceId?: string | null;
  serviceName?: string | null;
  revenueAmount?: number | null;
  packageSessionsRecovered?: number | null;
  attributionType?: AiRevenueAttributionType;
  eventAt?: string | null;
}

export interface AiRevenueRecordFollowUpAttemptInput {
  clinicId: string;
  actionId: string;
  channel: AiRevenueContactChannel;
  result: AiRevenueContactResult;
  note?: string | null;
  messageText?: string | null;
  nextFollowUpAt?: string | null;
  nextFollowUpDateKey?: string | null;
  suppressCustomer?: boolean;
  suppressionScope?: AiRevenueSuppressionScope;
  suppressionUntil?: string | null;
  permanentSuppression?: boolean;
  appointment?: AiRevenueFollowUpAppointmentInput;
  outcome?: AiRevenueFollowUpOutcomeInput;
  actor: AiRevenueActor | null;
}

interface AiRevenueLegacyFollowUpAttemptInput {
  clinicId: string;
  actionId: string;
  channel: AiRevenueFollowUpChannel;
  result: AiRevenueFollowUpResult;
  note?: string | null;
  contactedAt?: string | null;
  scheduleOption?: AiRevenueFollowUpScheduleOption;
  nextFollowUpDate?: string | null;
  suppressionScope?: AiRevenueSuppressionScope | null;
  bookingId?: string | null;
  appointmentDateTime?: string | null;
  treatmentCompletedAt?: string | null;
  packageSessionUsedAt?: string | null;
  packageSessionsRecovered?: number | null;
  repurchaseInvoiceNumber?: string | null;
  repurchaseRevenue?: number | null;
  revenueAttributedAt?: string | null;
  user?: SessionUser;
}

export type NormalizedAiRevenueFollowUpAttemptInput = AiRevenueRecordFollowUpAttemptInput & {
  contactedAt: string;
  source: "workflow" | "legacy";
  legacy?: {
    channel: AiRevenueFollowUpChannel;
    result: AiRevenueFollowUpResult;
    scheduleOption: AiRevenueFollowUpScheduleOption;
    nextFollowUpDate?: string | null;
  };
  user?: SessionUser;
};

export interface AiRevenueRecordFollowUpAttemptResult {
  action: AiRevenueAction;
  attempt: AiRevenueContactAttempt;
  timelineEvent: AiRevenueCustomerTimelineEvent;
  suppression?: AiRevenueCustomerSuppression;
  outcomeLink?: AiRevenueOutcomeLink;
}

interface AiRevenueLegacyRecordFollowUpAttemptResult {
  action: AiRevenueAction;
  attempt: AiRevenueFollowUpAttempt;
  contactAttempt: AiRevenueContactAttempt;
  timelineEvent: AiRevenueCustomerTimelineEvent;
  suppression?: AiRevenueCustomerSuppression;
  outcomeLink?: AiRevenueOutcomeLink;
}

function isWorkflowFollowUpAttemptInput(
  input: AiRevenueRecordFollowUpAttemptInput | AiRevenueLegacyFollowUpAttemptInput,
): input is AiRevenueRecordFollowUpAttemptInput {
  return "actor" in input;
}

function legacyChannelToContactChannel(channel: AiRevenueFollowUpChannel): AiRevenueContactChannel {
  switch (channel) {
    case "phone_call":
      return "phone";
    case "manual_viber":
      return "viber_manual";
    case "in_person":
      return "in_person";
    case "other":
    default:
      return "other";
  }
}

function contactChannelToLegacyChannel(channel: AiRevenueContactChannel): AiRevenueFollowUpChannel {
  switch (channel) {
    case "phone":
      return "phone_call";
    case "viber_manual":
    case "viber_auto":
      return "manual_viber";
    case "in_person":
      return "in_person";
    case "other":
    default:
      return "other";
  }
}

function contactResultToLegacyResult(result: AiRevenueContactResult): AiRevenueFollowUpResult {
  switch (result) {
    case "message_sent":
      return "other";
    case "customer_replied":
      return "interested";
    default:
      return result;
  }
}

function contactResultResolutionReason(result: AiRevenueContactResult): AiRevenueResolutionReason | null {
  switch (result) {
    case "not_interested":
      return "not_interested";
    case "wrong_number":
      return "wrong_number";
    case "do_not_contact":
      return "do_not_contact";
    default:
      return null;
  }
}

function defaultSuppressionScopeForContactResult(result: AiRevenueContactResult): AiRevenueSuppressionScope {
  return result === "wrong_number" ? "phone_only" : "customer";
}

function contactResultLabel(result: AiRevenueContactResult) {
  switch (result) {
    case "no_answer":
      return "No answer";
    case "call_later":
      return "Call later";
    case "message_sent":
      return "Message sent";
    case "customer_replied":
      return "Customer replied";
    case "interested":
      return "Interested";
    case "appointment_booked":
      return "Appointment booked";
    case "already_booked":
      return "Already booked";
    case "already_visited":
      return "Already visited";
    case "not_interested":
      return "Not interested";
    case "wrong_number":
      return "Wrong number";
    case "do_not_contact":
      return "Do not contact";
    case "completed":
      return "Completed";
    default:
      return "Other";
  }
}

function nextDateKeyFromWorkflowInput(input: Pick<AiRevenueRecordFollowUpAttemptInput, "nextFollowUpAt" | "nextFollowUpDateKey">) {
  return input.nextFollowUpDateKey ?? dateKeyFromMaybeIso(input.nextFollowUpAt) ?? null;
}

function hasAppointmentInput(value?: AiRevenueFollowUpAppointmentInput | null) {
  return Boolean(
    cleanText(value?.bookingId) ||
      cleanText(value?.appointmentDateTime) ||
      cleanText(value?.serviceId) ||
      cleanText(value?.serviceName) ||
      cleanText(value?.practitionerId) ||
      cleanText(value?.practitionerName) ||
      cleanText(value?.note),
  );
}

function numberOrPositiveNull(value: unknown) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return numeric;
}

function inferOutcomeType(input: {
  result: AiRevenueContactResult;
  outcome?: AiRevenueFollowUpOutcomeInput;
}): AiRevenueOutcomeType {
  if (input.outcome?.outcomeType) {
    return input.outcome.outcomeType;
  }
  if (cleanText(input.outcome?.invoiceNumber) || cleanText(input.outcome?.orderId) || numberOrPositiveNull(input.outcome?.revenueAmount)) {
    return "revenue_attributed";
  }
  if (numberOrPositiveNull(input.outcome?.packageSessionsRecovered)) {
    return "package_session_used";
  }
  if (cleanText(input.outcome?.treatmentId)) {
    return "treatment_completed";
  }
  if (cleanText(input.outcome?.bookingId) || input.result === "appointment_booked" || input.result === "already_booked") {
    return "appointment_booked";
  }
  return "revenue_attributed";
}

function normalizeFollowUpAttemptInput(
  input: AiRevenueRecordFollowUpAttemptInput | AiRevenueLegacyFollowUpAttemptInput,
): NormalizedAiRevenueFollowUpAttemptInput {
  if (isWorkflowFollowUpAttemptInput(input)) {
    const contactedAt = nowIso();
    const nextFollowUpDateKey = nextDateKeyFromWorkflowInput(input);
    return {
      ...input,
      note: input.note ?? null,
      messageText: input.messageText ?? null,
      nextFollowUpAt: input.nextFollowUpAt ?? nextFollowUpDateKey,
      nextFollowUpDateKey,
      suppressionUntil: input.suppressionUntil ?? null,
      appointment: input.appointment,
      outcome: input.outcome,
      actor: input.actor ?? null,
      contactedAt,
      source: "workflow",
    };
  }

  const contactedAt = cleanText(input.contactedAt) || nowIso();
  const scheduleOption = input.scheduleOption ?? "none";
  const nextFollowUpDate = nextFollowUpDateForSchedule({
    scheduleOption,
    contactedAt,
    customDate: input.nextFollowUpDate,
  });
  const channel = legacyChannelToContactChannel(input.channel);
  const result = input.result as AiRevenueContactResult;
  const packageSessionsRecovered = numberOrPositiveNull(input.packageSessionsRecovered);
  const repurchaseRevenue = numberOrPositiveNull(input.repurchaseRevenue);
  const appointment =
    cleanText(input.bookingId) || cleanText(input.appointmentDateTime)
      ? {
          bookingId: input.bookingId ?? null,
          appointmentDateTime: input.appointmentDateTime ?? null,
        }
      : undefined;
  const outcome: AiRevenueFollowUpOutcomeInput | undefined =
    cleanText(input.bookingId) ||
    cleanText(input.treatmentCompletedAt) ||
    cleanText(input.packageSessionUsedAt) ||
    packageSessionsRecovered ||
    cleanText(input.repurchaseInvoiceNumber) ||
    repurchaseRevenue ||
    cleanText(input.revenueAttributedAt)
      ? {
          outcomeType: cleanText(input.repurchaseInvoiceNumber) || repurchaseRevenue
            ? "repurchase"
            : cleanText(input.packageSessionUsedAt) || packageSessionsRecovered
              ? "package_session_used"
              : cleanText(input.treatmentCompletedAt)
                ? "treatment_completed"
                : "appointment_booked",
          bookingId: input.bookingId ?? null,
          invoiceNumber: input.repurchaseInvoiceNumber ?? null,
          revenueAmount: repurchaseRevenue,
          packageSessionsRecovered,
          attributionType: repurchaseRevenue
            ? "manual"
            : packageSessionsRecovered
              ? "package_recovery"
              : "manual",
          eventAt:
            input.revenueAttributedAt ??
            input.packageSessionUsedAt ??
            input.treatmentCompletedAt ??
            input.appointmentDateTime ??
            contactedAt,
        }
      : undefined;

  return {
    clinicId: input.clinicId,
    actionId: input.actionId,
    channel,
    result,
    note: input.note ?? null,
    messageText: null,
    nextFollowUpAt: nextFollowUpDate,
    nextFollowUpDateKey: nextFollowUpDate,
    suppressCustomer: result === "wrong_number" || result === "do_not_contact",
    suppressionScope: input.suppressionScope ?? undefined,
    suppressionUntil: null,
    permanentSuppression: result === "wrong_number" || result === "do_not_contact" ? true : undefined,
    appointment,
    outcome,
    actor: actorFromUser(input.user),
    contactedAt,
    source: "legacy",
    legacy: {
      channel: input.channel,
      result: input.result,
      scheduleOption,
      nextFollowUpDate,
    },
    user: input.user,
  };
}

export function deriveFollowUpWorkflowPatch(
  action: AiRevenueAction,
  attemptInput: NormalizedAiRevenueFollowUpAttemptInput,
): Partial<AiRevenueAction> {
  const nextDateKey = nextDateKeyFromWorkflowInput(attemptInput);
  if (attemptInput.result === "call_later" && !nextDateKey) {
    throw new HttpError(400, "Next follow-up date is required when recording a call later result.");
  }

  const hasNextDate = Boolean(nextDateKey);
  let workflowState: AiRevenueWorkflowState;
  let visibilityState: AiRevenueVisibilityState;
  let status: AiRevenueActionStatus | undefined;

  switch (attemptInput.result) {
    case "no_answer":
    case "message_sent":
      workflowState = hasNextDate ? "scheduled_follow_up" : "contacted";
      visibilityState = hasNextDate ? "scheduled" : "active";
      status = attemptInput.result === "message_sent" ? "sent" : "human_takeover";
      break;
    case "customer_replied":
    case "interested":
      workflowState = hasNextDate ? "scheduled_follow_up" : "waiting_customer";
      visibilityState = hasNextDate ? "scheduled" : "active";
      status = "customer_replied";
      break;
    case "call_later":
      workflowState = "scheduled_follow_up";
      visibilityState = "scheduled";
      status = "human_takeover";
      break;
    case "appointment_booked":
    case "already_booked":
      workflowState = "appointment_booked";
      visibilityState = "completed";
      status = cleanText(attemptInput.appointment?.bookingId) || cleanText(action.appointment.bookingId)
        ? "appointment_created"
        : "appointment_requested";
      break;
    case "already_visited":
      workflowState = "completed";
      visibilityState = "completed";
      status = attemptInput.outcome?.outcomeType === "treatment_completed" ? "completed" : "customer_came";
      break;
    case "not_interested":
      workflowState = "closed";
      visibilityState = attemptInput.suppressCustomer ? "suppressed" : "completed";
      status = "not_interested";
      break;
    case "wrong_number":
    case "do_not_contact":
      workflowState = "closed";
      visibilityState = "suppressed";
      status = "closed";
      break;
    case "completed":
      workflowState = "completed";
      visibilityState = "completed";
      status = "completed";
      break;
    case "other":
    default:
      workflowState = hasNextDate ? "scheduled_follow_up" : "contacted";
      visibilityState = hasNextDate ? "scheduled" : "active";
      status = "human_takeover";
      break;
  }

  const patch: Partial<AiRevenueAction> = {
    opportunityKey: action.opportunityKey ?? repository.buildOpportunityKey(action),
    attemptCount: (action.attemptCount ?? 0) + 1,
    lastContactAt: attemptInput.contactedAt,
    lastContactChannel: attemptInput.channel,
    lastContactResult: attemptInput.result,
    lastFollowUpNote: attemptInput.note ?? null,
    nextFollowUpAt: hasNextDate ? attemptInput.nextFollowUpAt ?? nextDateKey : null,
    dueDateKey: hasNextDate ? nextDateKey : action.dueDateKey ?? action.dateKey,
    workflowState,
    visibilityState,
  };

  if (status) {
    patch.status = status;
  }

  if (attemptInput.result === "not_interested" || attemptInput.result === "wrong_number" || attemptInput.result === "do_not_contact") {
    patch.closedAt = attemptInput.contactedAt;
    patch.closedReason = attemptInput.result;
  }

  if (attemptInput.result === "completed" || attemptInput.result === "already_visited") {
    patch.completedAt = attemptInput.contactedAt;
  }

  return patch;
}

function buildAppointmentPatch(
  action: AiRevenueAction,
  input: NormalizedAiRevenueFollowUpAttemptInput,
): Partial<AiRevenueAppointmentInfo> | null {
  if (
    !hasAppointmentInput(input.appointment) &&
    !["appointment_booked", "already_booked", "already_visited", "completed"].includes(input.result)
  ) {
    return null;
  }

  const patch: Partial<AiRevenueAppointmentInfo> = {};
  const bookingId = cleanText(input.appointment?.bookingId) || cleanText(input.outcome?.bookingId) || cleanText(action.appointment.bookingId);

  if (bookingId) {
    patch.bookingId = bookingId;
  }
  if (input.appointment?.appointmentDateTime) {
    patch.appointmentDateTime = input.appointment.appointmentDateTime;
  }
  if (input.appointment?.serviceId) {
    patch.serviceId = input.appointment.serviceId;
  }
  if (input.appointment?.serviceName) {
    patch.serviceName = input.appointment.serviceName;
  }
  if (input.appointment?.practitionerId) {
    patch.practitionerId = input.appointment.practitionerId;
  }
  if (input.appointment?.practitionerName) {
    patch.practitionerName = input.appointment.practitionerName;
  }
  if (input.appointment?.note != null) {
    patch.note = input.appointment.note;
  }

  if (input.result === "appointment_booked" || input.result === "already_booked") {
    patch.bookingStatus = bookingId ? "BOOKED" : "REQUESTED";
    patch.requestedAt = action.appointment.requestedAt ?? input.contactedAt;
  }
  if (input.result === "already_visited") {
    patch.bookingStatus = input.outcome?.outcomeType === "treatment_completed" ? "CHECKOUT" : "CHECKIN";
    patch.cameAt = action.appointment.cameAt ?? input.contactedAt;
    if (input.outcome?.outcomeType === "treatment_completed") {
      patch.completedAt = input.outcome.eventAt ?? input.contactedAt;
    }
  }
  if (input.result === "completed") {
    patch.bookingStatus = "CHECKOUT";
    patch.completedAt = input.outcome?.eventAt ?? input.contactedAt;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

function buildRevenuePatch(input: NormalizedAiRevenueFollowUpAttemptInput): Partial<AiRevenueRevenueInfo> | null {
  if (!input.outcome) {
    return null;
  }

  const patch: Partial<AiRevenueRevenueInfo> = {};
  const revenueAmount = numberOrPositiveNull(input.outcome.revenueAmount);
  const packageSessionsRecovered = numberOrPositiveNull(input.outcome.packageSessionsRecovered);

  if (revenueAmount != null) {
    patch.actualRevenue = revenueAmount;
  }
  if (packageSessionsRecovered != null) {
    patch.packageSessionsRecovered = packageSessionsRecovered;
  }
  if (input.outcome.orderId) {
    patch.orderId = input.outcome.orderId;
  }
  if (input.outcome.invoiceNumber) {
    patch.invoiceNumber = input.outcome.invoiceNumber;
  }
  if (input.outcome.attributionType) {
    patch.attributionType = input.outcome.attributionType;
  }
  if (input.outcome.eventAt) {
    patch.revenueAt = input.outcome.eventAt;
  }
  if (input.note != null) {
    patch.revenueNote = input.note;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

function buildLegacyFollowUpOutcome(
  action: AiRevenueAction,
  input: NormalizedAiRevenueFollowUpAttemptInput,
): AiRevenueFollowUpOutcomeInfo {
  const packageSessionsRecovered = numberOrPositiveNull(input.outcome?.packageSessionsRecovered);
  const repurchaseRevenue = numberOrPositiveNull(input.outcome?.revenueAmount);
  const outcomeType = input.outcome ? inferOutcomeType({ result: input.result, outcome: input.outcome }) : null;

  return {
    ...action.followUp.outcome,
    appointmentBookingId:
      input.appointment?.bookingId ??
      input.outcome?.bookingId ??
      action.appointment.bookingId ??
      action.followUp.outcome.appointmentBookingId ??
      null,
    appointmentBookedAt:
      input.result === "appointment_booked" || input.result === "already_booked"
        ? input.contactedAt
        : action.followUp.outcome.appointmentBookedAt ?? null,
    appointmentDateTime:
      input.appointment?.appointmentDateTime ??
      action.appointment.appointmentDateTime ??
      action.followUp.outcome.appointmentDateTime ??
      null,
    customerCameAt:
      input.result === "already_visited"
        ? input.contactedAt
        : action.appointment.cameAt ?? action.followUp.outcome.customerCameAt ?? null,
    treatmentCompletedAt:
      outcomeType === "treatment_completed" || input.result === "completed"
        ? input.outcome?.eventAt ?? input.contactedAt
        : action.appointment.completedAt ?? action.followUp.outcome.treatmentCompletedAt ?? null,
    packageSessionUsedAt:
      outcomeType === "package_session_used" || packageSessionsRecovered
        ? input.outcome?.eventAt ?? input.contactedAt
        : action.followUp.outcome.packageSessionUsedAt ?? null,
    packageSessionsRecovered:
      packageSessionsRecovered ?? action.revenue.packageSessionsRecovered ?? action.followUp.outcome.packageSessionsRecovered ?? 0,
    repurchaseInvoiceNumber:
      input.outcome?.invoiceNumber ?? action.revenue.invoiceNumber ?? action.followUp.outcome.repurchaseInvoiceNumber ?? null,
    repurchaseRevenue: repurchaseRevenue ?? action.revenue.actualRevenue ?? action.followUp.outcome.repurchaseRevenue ?? 0,
    revenueAttributedAt:
      outcomeType === "revenue_attributed" || outcomeType === "repurchase"
        ? input.outcome?.eventAt ?? input.contactedAt
        : action.revenue.revenueAt ?? action.followUp.outcome.revenueAttributedAt ?? null,
    attributionType: input.outcome?.attributionType ?? action.revenue.attributionType ?? action.followUp.outcome.attributionType ?? "unknown",
  };
}

function shouldCreateSuppression(input: NormalizedAiRevenueFollowUpAttemptInput) {
  return input.result === "wrong_number" || input.result === "do_not_contact" || input.suppressCustomer === true;
}

function shouldCreateMessageEvent(input: NormalizedAiRevenueFollowUpAttemptInput) {
  return (
    input.result === "message_sent" &&
    Boolean(cleanText(input.messageText)) &&
    (input.channel === "viber_manual" || input.channel === "viber_auto" || input.channel === "other")
  );
}

function isClosedFollowUpResult(result: AiRevenueContactResult) {
  return result === "not_interested" || result === "wrong_number" || result === "do_not_contact";
}

function isCompletedFollowUpResult(result: AiRevenueContactResult) {
  return ["appointment_booked", "already_booked", "already_visited", "completed"].includes(result);
}

function legacyFollowUpStatusFromVisibility(visibilityState?: AiRevenueVisibilityState) {
  if (visibilityState === "suppressed") {
    return "suppressed" as const;
  }
  if (visibilityState === "completed") {
    return "completed" as const;
  }
  return "open" as const;
}

function buildAuditActor(input: NormalizedAiRevenueFollowUpAttemptInput) {
  return {
    actorType: "staff" as const,
    actorId: input.actor?.userId ?? input.user?.userId ?? input.user?.uid ?? null,
  };
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

export async function getAiRevenueRunSummary(input: { clinicId: string; dateKey: string }) {
  return repository.getAiRevenueRunSummary(input);
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
  await repository.saveAiRevenueRunSummary({
    clinicId: input.clinicId,
    clinicCode: input.clinicCode,
    dateKey,
    generatedCount: generated.generatedCount,
    skippedExistingCount: generated.skippedExistingCount,
    refreshedExistingCount: generated.refreshedExistingCount,
    actionCount: generated.actions.length,
    sourceStatus: generated.sourceStatus,
  });

  return {
    dateKey,
    generatedCount: generated.generatedCount,
    skippedExistingCount: generated.skippedExistingCount,
    refreshedExistingCount: generated.refreshedExistingCount,
    suppressedSkippedCount: generated.suppressedSkippedCount,
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

function defaultSuppressCustomer(reason: AiRevenueResolutionReason) {
  return [
    "not_interested",
    "moved_overseas",
    "deceased",
    "wrong_number",
    "duplicate_customer",
    "do_not_contact",
  ].includes(reason);
}

function defaultPermanentSuppression(reason: AiRevenueResolutionReason) {
  return ["moved_overseas", "deceased", "wrong_number", "duplicate_customer", "do_not_contact"].includes(reason);
}

function defaultSuppressionScope(reason: AiRevenueResolutionReason): AiRevenueSuppressionScope {
  return reason === "wrong_number" ? "phone_only" : "customer";
}

function statusForResolution(reason: AiRevenueResolutionReason): AiRevenueActionStatus {
  return reason === "not_interested" ? "not_interested" : "closed";
}

function resolutionReasonLabel(reason: AiRevenueResolutionReason) {
  switch (reason) {
    case "already_contacted":
      return "Already contacted";
    case "already_booked":
      return "Already booked";
    case "not_interested":
      return "Not interested";
    case "moved_overseas":
      return "Moved overseas";
    case "deceased":
      return "Deceased / do not contact";
    case "wrong_number":
      return "Wrong number";
    case "duplicate_customer":
      return "Duplicate customer";
    case "do_not_contact":
      return "Do not contact";
    case "staff_decision":
      return "Staff decision";
    default:
      return "Other";
  }
}

export async function resolveAiRevenueAction(input: {
  clinicId: string;
  actionId: string;
  reason: AiRevenueResolutionReason;
  note?: string | null;
  suppressCustomer?: boolean;
  permanentSuppression?: boolean;
  suppressUntil?: string | null;
  snoozeDays?: number;
  scope?: AiRevenueSuppressionScope;
  user?: SessionUser;
}) {
  const current = await repository.getAction(input.clinicId, input.actionId);
  const actor = actorFromUser(input.user);
  const timestamp = nowIso();
  const suppressCustomer = input.suppressCustomer ?? defaultSuppressCustomer(input.reason);
  const permanentSuppression = input.permanentSuppression ?? defaultPermanentSuppression(input.reason);
  const scope = input.scope ?? defaultSuppressionScope(input.reason);
  const suppressUntil =
    suppressCustomer && !permanentSuppression
      ? input.suppressUntil ?? addDays(dateKeyFromIso(timestamp), input.snoozeDays ?? 30)
      : null;
  let suppressionId: string | null = null;

  if (suppressCustomer) {
    const suppression = await repository.createCustomerSuppression({
      clinicId: input.clinicId,
      customer: current.customer,
      service: current.service,
      reason: input.reason,
      scope,
      sourceActionId: input.actionId,
      suppressUntil,
      note: input.note,
      createdBy: actor,
    });
    suppressionId = suppression.id;

    await repository.createAuditLog({
      clinicId: input.clinicId,
      actionId: input.actionId,
      actorType: "staff",
      actorId: input.user?.userId ?? input.user?.uid ?? null,
      action: "customer_suppressed",
      description: permanentSuppression
        ? `Customer suppressed from future AI Revenue opportunities: ${resolutionReasonLabel(input.reason)}.`
        : `Customer snoozed from AI Revenue opportunities until ${suppressUntil}.`,
      afterValue: {
        reason: input.reason,
        scope,
        suppressionId,
        suppressUntil,
      },
    });
  }

  const resolution = {
    reason: input.reason,
    note: input.note ?? null,
    suppressCustomer,
    suppressionId,
    resolvedAt: timestamp,
    resolvedBy: actor,
  };
  const action = await repository.updateActionResolution({
    clinicId: input.clinicId,
    actionId: input.actionId,
    status: statusForResolution(input.reason),
    resolution,
    updatedBy: actor,
  });

  await repository.createAuditLog({
    clinicId: input.clinicId,
    actionId: input.actionId,
    actorType: "staff",
    actorId: input.user?.userId ?? input.user?.uid ?? null,
    action: "action_resolved",
    description: `AI Revenue opportunity resolved: ${resolutionReasonLabel(input.reason)}.`,
    afterValue: resolution,
  });
  await createStatusSideEffectAudit({
    clinicId: input.clinicId,
    actionId: input.actionId,
    status: action.status,
    user: input.user,
    existingAuditAction: "action_resolved",
  });

  return action;
}

async function createOutcomeLinkForFollowUp(input: {
  action: AiRevenueAction;
  attempt: AiRevenueContactAttempt;
  followUpInput: NormalizedAiRevenueFollowUpAttemptInput;
}) {
  const action = input.action;
  const followUpInput = input.followUpInput;
  const hasAutoAppointmentOutcome =
    (followUpInput.result === "appointment_booked" || followUpInput.result === "already_booked") &&
    (hasAppointmentInput(followUpInput.appointment) ||
      cleanText(action.appointment.bookingId) ||
      cleanText(action.appointment.appointmentDateTime));
  const hasExplicitOutcome = Boolean(
    followUpInput.outcome &&
      (followUpInput.outcome.outcomeType ||
        cleanText(followUpInput.outcome.bookingId) ||
        cleanText(followUpInput.outcome.treatmentId) ||
        cleanText(followUpInput.outcome.orderId) ||
        cleanText(followUpInput.outcome.invoiceNumber) ||
        numberOrPositiveNull(followUpInput.outcome.revenueAmount) ||
        numberOrPositiveNull(followUpInput.outcome.packageSessionsRecovered)),
  );

  if (!hasExplicitOutcome && !hasAutoAppointmentOutcome) {
    return undefined;
  }

  const outcome = hasExplicitOutcome
    ? followUpInput.outcome!
    : {
        outcomeType: "appointment_booked" as const,
        bookingId: followUpInput.appointment?.bookingId ?? action.appointment.bookingId ?? null,
        serviceId: followUpInput.appointment?.serviceId ?? action.service.serviceId ?? action.appointment.serviceId ?? null,
        serviceName: followUpInput.appointment?.serviceName ?? action.service.serviceName ?? action.appointment.serviceName ?? null,
        attributionType: "manual" as const,
        eventAt: followUpInput.appointment?.appointmentDateTime ?? followUpInput.contactedAt,
      };
  const outcomeType = inferOutcomeType({ result: followUpInput.result, outcome });
  const attributionType =
    outcome.attributionType ?? (outcomeType === "package_session_used" ? "package_recovery" : "manual");

  return repository.createOutcomeLink({
    clinicId: followUpInput.clinicId,
    actionId: followUpInput.actionId,
    opportunityKey: action.opportunityKey ?? repository.buildOpportunityKey(action),
    contactAttemptId: input.attempt.id,
    customerKey: action.customer.customerKey ?? null,
    memberId: action.customer.memberId ?? null,
    phoneHash: repository.phoneHash(action.customer.phoneNumber) ?? null,
    outcomeType,
    bookingId: outcome.bookingId ?? followUpInput.appointment?.bookingId ?? action.appointment.bookingId ?? null,
    treatmentId: outcome.treatmentId ?? null,
    orderId: outcome.orderId ?? null,
    invoiceNumber: outcome.invoiceNumber ?? null,
    serviceId: outcome.serviceId ?? followUpInput.appointment?.serviceId ?? action.service.serviceId ?? action.appointment.serviceId ?? null,
    serviceName:
      outcome.serviceName ?? followUpInput.appointment?.serviceName ?? action.service.serviceName ?? action.appointment.serviceName ?? null,
    revenueAmount: numberOrPositiveNull(outcome.revenueAmount),
    packageSessionsRecovered: numberOrPositiveNull(outcome.packageSessionsRecovered),
    attributionType,
    attributionWindowDays: null,
    confidence: 1,
    eventAt: outcome.eventAt ?? followUpInput.appointment?.appointmentDateTime ?? followUpInput.contactedAt,
  });
}

async function createOutcomeLinkForAction(input: {
  action: AiRevenueAction;
  outcomeType: AiRevenueOutcomeType;
  contactAttemptId?: string | null;
  bookingId?: string | null;
  treatmentId?: string | null;
  orderId?: string | null;
  invoiceNumber?: string | null;
  serviceId?: string | null;
  serviceName?: string | null;
  revenueAmount?: number | null;
  packageSessionsRecovered?: number | null;
  attributionType?: AiRevenueAttributionType | null;
  attributionWindowDays?: number | null;
  confidence?: number | null;
  eventAt?: string | null;
}) {
  const action = input.action;
  const revenue = action.revenue ?? {};
  const appointment = action.appointment ?? {};
  const service = action.service ?? {};

  return repository.createOutcomeLink({
    clinicId: action.clinicId,
    actionId: action.id,
    opportunityKey: action.opportunityKey ?? repository.buildOpportunityKey(action),
    contactAttemptId: input.contactAttemptId ?? null,
    customerKey: action.customer.customerKey ?? null,
    memberId: action.customer.memberId ?? null,
    phoneHash: repository.phoneHash(action.customer.phoneNumber) ?? null,
    outcomeType: input.outcomeType,
    bookingId: input.bookingId ?? appointment.bookingId ?? null,
    treatmentId: input.treatmentId ?? null,
    orderId: input.orderId ?? revenue.orderId ?? null,
    invoiceNumber: input.invoiceNumber ?? revenue.invoiceNumber ?? null,
    serviceId: input.serviceId ?? appointment.serviceId ?? service.serviceId ?? null,
    serviceName: input.serviceName ?? appointment.serviceName ?? service.serviceName ?? null,
    revenueAmount: numberOrPositiveNull(input.revenueAmount),
    packageSessionsRecovered: numberOrPositiveNull(input.packageSessionsRecovered),
    attributionType: input.attributionType ?? revenue.attributionType ?? "manual",
    attributionWindowDays: input.attributionWindowDays ?? null,
    confidence: input.confidence ?? 1,
    eventAt: input.eventAt ?? nowIso(),
  });
}

async function createAppointmentOutcomeLinksForAction(input: {
  action: AiRevenueAction;
  patch: Partial<AiRevenueAppointmentInfo>;
  status?: AiRevenueActionStatus;
}) {
  const links: AiRevenueOutcomeLink[] = [];
  const action = input.action;
  const patch = input.patch;
  const appointment = action.appointment ?? {};
  const serviceId = patch.serviceId ?? appointment.serviceId ?? action.service.serviceId ?? null;
  const serviceName = patch.serviceName ?? appointment.serviceName ?? action.service.serviceName ?? null;
  const bookingId = patch.bookingId ?? appointment.bookingId ?? null;
  const appointmentDateTime = patch.appointmentDateTime ?? appointment.appointmentDateTime ?? null;

  if (
    cleanText(bookingId) &&
    (input.status === "appointment_requested" ||
      input.status === "appointment_created" ||
      input.status === "appointment_confirmed" ||
      Boolean(cleanText(patch.bookingId)))
  ) {
    links.push(
      await createOutcomeLinkForAction({
        action,
        outcomeType: "appointment_booked",
        bookingId,
        serviceId,
        serviceName,
        attributionType: "manual",
        eventAt: appointmentDateTime ?? appointment.requestedAt ?? action.lastStatusAt ?? action.updatedAt,
      }),
    );
  }

  if (input.status === "customer_came" || cleanText(patch.cameAt)) {
    links.push(
      await createOutcomeLinkForAction({
        action,
        outcomeType: "customer_came",
        bookingId,
        serviceId,
        serviceName,
        attributionType: "manual",
        eventAt: patch.cameAt ?? appointment.cameAt ?? action.lastStatusAt ?? action.updatedAt,
      }),
    );
  }

  if (input.status === "completed" || cleanText(patch.completedAt)) {
    links.push(
      await createOutcomeLinkForAction({
        action,
        outcomeType: "treatment_completed",
        bookingId,
        serviceId,
        serviceName,
        attributionType: "exact_booking",
        eventAt: patch.completedAt ?? appointment.completedAt ?? action.lastStatusAt ?? action.updatedAt,
      }),
    );
  }

  return links;
}

async function createRevenueOutcomeLinksForAction(input: {
  action: AiRevenueAction;
  revenue?: Partial<AiRevenueRevenueInfo> | null;
  attributionWindowDays?: number | null;
}) {
  const links: AiRevenueOutcomeLink[] = [];
  const action = input.action;
  const revenue = { ...(action.revenue ?? {}), ...(input.revenue ?? {}) };
  const actualRevenue = numberOrPositiveNull(revenue.actualRevenue);
  const influencedRevenue = numberOrPositiveNull(revenue.influencedRevenue);
  const packageSessionsRecovered = numberOrPositiveNull(revenue.packageSessionsRecovered);
  const orderId = revenue.orderId ?? action.revenue.orderId ?? null;
  const invoiceNumber = revenue.invoiceNumber ?? action.revenue.invoiceNumber ?? null;
  const attributionType = revenue.attributionType ?? action.revenue.attributionType ?? "manual";
  const eventAt = revenue.revenueAt ?? action.revenue.revenueAt ?? action.appointment.completedAt ?? action.lastStatusAt ?? action.updatedAt;

  if (packageSessionsRecovered) {
    links.push(
      await createOutcomeLinkForAction({
        action,
        outcomeType: "package_session_used",
        orderId,
        invoiceNumber,
        packageSessionsRecovered,
        attributionType: "package_recovery",
        attributionWindowDays: input.attributionWindowDays ?? null,
        eventAt,
      }),
    );
  }

  if (actualRevenue || cleanText(invoiceNumber)) {
    links.push(
      await createOutcomeLinkForAction({
        action,
        outcomeType: "repurchase",
        orderId,
        invoiceNumber,
        revenueAmount: actualRevenue ?? influencedRevenue,
        attributionType,
        attributionWindowDays: input.attributionWindowDays ?? null,
        eventAt,
      }),
    );
  }

  if (actualRevenue || influencedRevenue || cleanText(orderId) || cleanText(invoiceNumber)) {
    links.push(
      await createOutcomeLinkForAction({
        action,
        outcomeType: "revenue_attributed",
        orderId,
        invoiceNumber,
        revenueAmount: numberOrPositiveNull((actualRevenue ?? 0) + (influencedRevenue ?? 0)) ?? actualRevenue ?? influencedRevenue,
        attributionType,
        attributionWindowDays: input.attributionWindowDays ?? null,
        eventAt,
      }),
    );
  }

  return links;
}

export async function recordAiRevenueFollowUpAttempt(
  input: AiRevenueRecordFollowUpAttemptInput,
): Promise<AiRevenueRecordFollowUpAttemptResult>;
export async function recordAiRevenueFollowUpAttempt(
  input: AiRevenueLegacyFollowUpAttemptInput,
): Promise<AiRevenueLegacyRecordFollowUpAttemptResult>;
export async function recordAiRevenueFollowUpAttempt(
  input: AiRevenueRecordFollowUpAttemptInput | AiRevenueLegacyFollowUpAttemptInput,
): Promise<AiRevenueRecordFollowUpAttemptResult | AiRevenueLegacyRecordFollowUpAttemptResult> {
  const current = await repository.getAction(input.clinicId, input.actionId);
  if (current.clinicId !== input.clinicId) {
    throw new HttpError(404, `AI Revenue action ${input.actionId} was not found.`);
  }

  const followUpInput = normalizeFollowUpAttemptInput(input);
  const workflowPatch = deriveFollowUpWorkflowPatch(current, followUpInput);
  const opportunityKey = workflowPatch.opportunityKey ?? current.opportunityKey ?? repository.buildOpportunityKey(current);
  const nextFollowUpDateKey = nextDateKeyFromWorkflowInput(followUpInput);
  const actor = followUpInput.actor;
  const auditActor = buildAuditActor(followUpInput);

  const attempt = await repository.createContactAttempt({
    clinicId: followUpInput.clinicId,
    actionId: followUpInput.actionId,
    opportunityKey,
    customerKey: current.customer.customerKey ?? null,
    memberId: current.customer.memberId ?? null,
    phoneHash: repository.phoneHash(current.customer.phoneNumber) ?? null,
    customerName: current.customer.customerName ?? null,
    agentUserId: actor?.userId ?? null,
    agentName: actor?.name ?? actor?.email ?? null,
    channel: followUpInput.channel,
    result: followUpInput.result,
    note: followUpInput.note ?? null,
    messageText: followUpInput.messageText ?? null,
    nextFollowUpAt: followUpInput.nextFollowUpAt ?? null,
    nextFollowUpDateKey,
    createdAt: followUpInput.contactedAt,
    createdBy: actor,
  });

  const timelineEvent = await repository.createCustomerTimelineEvent({
    clinicId: followUpInput.clinicId,
    actionId: followUpInput.actionId,
    contactAttemptId: attempt.id,
    customerKey: current.customer.customerKey ?? null,
    memberId: current.customer.memberId ?? null,
    phoneHash: repository.phoneHash(current.customer.phoneNumber) ?? null,
    customerName: current.customer.customerName ?? null,
    serviceName: followUpInput.appointment?.serviceName ?? followUpInput.outcome?.serviceName ?? current.service.serviceName ?? null,
    result: followUpInput.result,
    channel: followUpInput.channel,
    note: followUpInput.note ?? null,
    nextFollowUpAt: followUpInput.nextFollowUpAt ?? null,
    createdAt: followUpInput.contactedAt,
    createdBy: actor,
  });

  if (shouldCreateMessageEvent(followUpInput)) {
    await repository.createMessageEvent({
      clinicId: followUpInput.clinicId,
      actionId: followUpInput.actionId,
      memberId: current.customer.memberId ?? null,
      channel: followUpInput.channel,
      direction: "outbound",
      messageText: cleanText(followUpInput.messageText),
      intent: "human_follow_up",
      confidence: 1,
      providerMessageId: null,
      createdAt: followUpInput.contactedAt,
      createdBy: actor,
    });
  }

  let suppression: AiRevenueCustomerSuppression | undefined;
  if (shouldCreateSuppression(followUpInput)) {
    const suppressionReason = contactResultResolutionReason(followUpInput.result) ?? "staff_decision";
    suppression = await repository.createCustomerSuppression({
      clinicId: followUpInput.clinicId,
      customer: current.customer,
      service: current.service,
      channel: followUpInput.channel,
      reason: suppressionReason,
      scope: followUpInput.suppressionScope ?? defaultSuppressionScopeForContactResult(followUpInput.result),
      sourceActionId: followUpInput.actionId,
      sourceAttemptId: attempt.id,
      permanent:
        followUpInput.permanentSuppression ??
        (followUpInput.result === "wrong_number" || followUpInput.result === "do_not_contact" ? true : undefined),
      suppressUntil: followUpInput.suppressionUntil ?? null,
      note: followUpInput.note ?? null,
      createdBy: actor,
    });
  }

  const outcomeLink = await createOutcomeLinkForFollowUp({
    action: current,
    attempt,
    followUpInput,
  });
  const appointmentPatch = buildAppointmentPatch(current, followUpInput);
  const revenuePatch = buildRevenuePatch(followUpInput);
  const legacyOutcome = buildLegacyFollowUpOutcome(current, followUpInput);

  let legacyAttempt: AiRevenueFollowUpAttempt | undefined;
  if (followUpInput.source === "legacy") {
    legacyAttempt = await repository.createFollowUpAttempt({
      clinicId: followUpInput.clinicId,
      actionId: followUpInput.actionId,
      memberId: current.customer.memberId ?? null,
      customerKey: current.customer.customerKey ?? null,
      channel: followUpInput.legacy?.channel ?? contactChannelToLegacyChannel(followUpInput.channel),
      result: followUpInput.legacy?.result ?? contactResultToLegacyResult(followUpInput.result),
      note: followUpInput.note ?? null,
      contactedAt: followUpInput.contactedAt,
      scheduleOption: followUpInput.legacy?.scheduleOption ?? "none",
      nextFollowUpDate: followUpInput.legacy?.nextFollowUpDate ?? nextFollowUpDateKey,
      suppressionScope: suppression
        ? followUpInput.suppressionScope ?? defaultSuppressionScopeForContactResult(followUpInput.result)
        : null,
      suppressionId: suppression?.id ?? null,
      outcome: legacyOutcome,
      createdAt: followUpInput.contactedAt,
      createdBy: actor,
    });
  }

  const legacyStatus = legacyFollowUpStatusFromVisibility(workflowPatch.visibilityState);
  const followUpCompleted =
    legacyStatus === "completed" || isCompletedFollowUpResult(followUpInput.result) || isClosedFollowUpResult(followUpInput.result);
  const followUpPatch = {
    status: legacyStatus,
    dueDate:
      legacyStatus === "open"
        ? nextFollowUpDateKey ?? workflowPatch.dueDateKey ?? dateKeyFromMaybeIso(followUpInput.contactedAt)
        : null,
    nextFollowUpDate: legacyStatus === "open" ? nextFollowUpDateKey : null,
    lastAttemptId: legacyAttempt?.id ?? attempt.id,
    lastContactedAt: followUpInput.contactedAt,
    lastChannel: followUpInput.legacy?.channel ?? contactChannelToLegacyChannel(followUpInput.channel),
    lastResult: followUpInput.legacy?.result ?? contactResultToLegacyResult(followUpInput.result),
    lastNote: followUpInput.note ?? null,
    lastHandledBy: actor,
    attemptCount: current.followUp.attemptCount + 1,
    completedAt: followUpCompleted && legacyStatus !== "suppressed" ? followUpInput.contactedAt : current.followUp.completedAt ?? null,
    completedBy: followUpCompleted && legacyStatus !== "suppressed" ? actor : current.followUp.completedBy ?? null,
    suppressedAt: suppression ? followUpInput.contactedAt : current.followUp.suppressedAt ?? null,
    suppressionId: suppression?.id ?? current.followUp.suppressionId ?? null,
    outcome: legacyOutcome,
  };

  const actionPatch: Partial<AiRevenueAction> = {
    ...workflowPatch,
    opportunityKey,
    lastFollowUpAttemptId: attempt.id,
    followUp: followUpPatch,
  };
  if (appointmentPatch) {
    actionPatch.appointment = appointmentPatch;
  }
  if (revenuePatch) {
    actionPatch.revenue = revenuePatch;
  }
  if (isClosedFollowUpResult(followUpInput.result)) {
    const reason = contactResultResolutionReason(followUpInput.result) ?? "staff_decision";
    actionPatch.resolution = {
      reason,
      note: followUpInput.note ?? null,
      suppressCustomer: Boolean(suppression),
      suppressionId: suppression?.id ?? null,
      resolvedAt: followUpInput.contactedAt,
      resolvedBy: actor,
    };
  }

  const action = await repository.updateActionFollowUpWorkflow({
    clinicId: followUpInput.clinicId,
    actionId: followUpInput.actionId,
    patch: actionPatch,
    actor,
    auditDescription: `Staff follow-up recorded: ${contactResultLabel(followUpInput.result)} via ${followUpInput.channel.replace(/_/g, " ")}.`,
  });

  await createStatusSideEffectAudit({
    clinicId: followUpInput.clinicId,
    actionId: followUpInput.actionId,
    status: action.status,
    user: followUpInput.user,
    existingAuditAction: "follow_up_workflow_updated",
  });

  await repository.createAuditLog({
    clinicId: followUpInput.clinicId,
    actionId: followUpInput.actionId,
    actorType: auditActor.actorType,
    actorId: auditActor.actorId,
    action: "human_follow_up_recorded",
    description: `Human follow-up result recorded: ${contactResultLabel(followUpInput.result)}.`,
    afterValue: {
      contactAttemptId: attempt.id,
      legacyAttemptId: legacyAttempt?.id ?? null,
      timelineEventId: timelineEvent.id,
      outcomeLinkId: outcomeLink?.id ?? null,
      suppressionId: suppression?.id ?? null,
      channel: followUpInput.channel,
      result: followUpInput.result,
      note: followUpInput.note ?? null,
      nextFollowUpAt: followUpInput.nextFollowUpAt ?? null,
      nextFollowUpDateKey,
      workflowState: action.workflowState,
      visibilityState: action.visibilityState,
    },
  });

  if (legacyAttempt) {
    return {
      action,
      attempt: legacyAttempt,
      contactAttempt: attempt,
      timelineEvent,
      suppression,
      outcomeLink,
    };
  }

  return {
    action,
    attempt,
    timelineEvent,
    suppression,
    outcomeLink,
  };
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
  await createAppointmentOutcomeLinksForAction({
    action: nextAction,
    patch,
    status: input.status,
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
  const action = await recordManualAiRevenue(input);
  await createRevenueOutcomeLinksForAction({
    action,
    revenue: input.patch,
  });

  return action;
}

export async function syncAiRevenueRevenue(input: {
  clinicId: string;
  actionId: string;
  clinicCode?: string | null;
  attributionWindowDays?: number;
  authorizationHeader?: string;
  user?: SessionUser;
}) {
  const action = await syncAiRevenueAttribution(input);
  await createRevenueOutcomeLinksForAction({
    action,
    revenue: action.revenue,
    attributionWindowDays: input.attributionWindowDays,
  });

  return action;
}

export async function listAiRevenueAuditLogs(input: Parameters<typeof repository.listAuditLogs>[0]) {
  return repository.listAuditLogs(input);
}

export async function listAiRevenueContactAttempts(input: Parameters<typeof repository.listContactAttempts>[0]) {
  return repository.listContactAttempts(input);
}

export async function listAiRevenueOutcomeLinks(input: Parameters<typeof repository.listOutcomeLinks>[0]) {
  return repository.listOutcomeLinks(input);
}

export async function createAiRevenueOutcomeLink(input: {
  clinicId: string;
  actionId: string;
  outcomeType: AiRevenueOutcomeType;
  contactAttemptId?: string | null;
  bookingId?: string | null;
  treatmentId?: string | null;
  orderId?: string | null;
  invoiceNumber?: string | null;
  serviceId?: string | null;
  serviceName?: string | null;
  revenueAmount?: number | null;
  packageSessionsRecovered?: number | null;
  attributionType?: AiRevenueAttributionType | null;
  attributionWindowDays?: number | null;
  confidence?: number | null;
  eventAt?: string | null;
  user?: SessionUser;
}) {
  const action = await repository.getAction(input.clinicId, input.actionId);
  if (action.clinicId !== input.clinicId) {
    throw new HttpError(404, `AI Revenue action ${input.actionId} was not found.`);
  }

  const outcomeLink = await createOutcomeLinkForAction({
    action,
    outcomeType: input.outcomeType,
    contactAttemptId: input.contactAttemptId,
    bookingId: input.bookingId,
    treatmentId: input.treatmentId,
    orderId: input.orderId,
    invoiceNumber: input.invoiceNumber,
    serviceId: input.serviceId,
    serviceName: input.serviceName,
    revenueAmount: input.revenueAmount,
    packageSessionsRecovered: input.packageSessionsRecovered,
    attributionType: input.attributionType,
    attributionWindowDays: input.attributionWindowDays,
    confidence: input.confidence,
    eventAt: input.eventAt,
  });

  await repository.createAuditLog({
    clinicId: input.clinicId,
    actionId: input.actionId,
    actorType: "staff",
    actorId: input.user?.userId ?? input.user?.uid ?? null,
    action: "outcome_link_created",
    description: `Structured AI Revenue outcome recorded: ${input.outcomeType}.`,
    afterValue: outcomeLink,
  });

  return outcomeLink;
}

export async function listAiRevenueCustomerSuppressions(input: Parameters<typeof repository.listCustomerSuppressions>[0]) {
  return repository.listCustomerSuppressions(input);
}

export async function liftAiRevenueCustomerSuppression(input: {
  clinicId: string;
  suppressionId: string;
  user?: SessionUser;
}) {
  const suppression = await repository.liftCustomerSuppression({
    clinicId: input.clinicId,
    suppressionId: input.suppressionId,
    liftedBy: actorFromUser(input.user),
  });

  await repository.createAuditLog({
    clinicId: input.clinicId,
    actionId: suppression.sourceActionId ?? null,
    actorType: "staff",
    actorId: input.user?.userId ?? input.user?.uid ?? null,
    action: "customer_suppression_lifted",
    description: "Staff lifted an AI Revenue customer suppression.",
    afterValue: {
      suppressionId: suppression.id,
      reason: suppression.reason,
      scope: suppression.scope,
    },
  });

  return suppression;
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
