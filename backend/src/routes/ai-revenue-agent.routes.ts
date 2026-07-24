import { Router } from "express";
import { z } from "zod";
import { verifyFirebaseToken } from "../middleware/auth.js";
import { requireClinicAccess } from "../middleware/clinic-access.js";
import {
  type AiRevenueSettings,
  type AiRevenueActionStatus,
  aiRevenueActionSources,
  aiRevenueActionStatuses,
  aiRevenueActionTypes,
  aiRevenueAttributionTypes,
  aiRevenueContactChannels,
  aiRevenueContactResults,
  aiRevenueFollowUpChannels,
  aiRevenueFollowUpResults,
  aiRevenueFollowUpScheduleOptions,
  aiRevenueOutcomeTypes,
  aiRevenueResolutionReasons,
  aiRevenueSuppressionScopes,
  aiRevenueVisibilityStates,
  aiRevenueWorkflowStates,
} from "../types/ai-revenue-agent.js";
import {
  createAiRevenueOutcomeLink,
  createAiRevenueMessageEvent,
  generateAiRevenueActionsOnce,
  generateAiRevenueMessage,
  getAiRevenueAction,
  getAiRevenueGenerationStatus,
  getActorFromUser,
  getAiRevenueSettings,
  getAiRevenueSummary,
  listAiRevenueActions,
  listAiRevenueAuditLogs,
  listAiRevenueContactAttempts,
  listAiRevenueCustomerSuppressions,
  listAiRevenueOutcomeLinks,
  approveAiRevenueMessage,
  liftAiRevenueCustomerSuppression,
  recordAiRevenueFollowUpAttempt,
  requestAiRevenueBooking,
  resolveAiRevenueAction,
  saveAiRevenueSettings,
  syncAiRevenueAppointmentOutcome,
  syncAiRevenueRevenue,
  updateAiRevenueAppointment,
  updateAiRevenueMessage,
  updateAiRevenueRevenue,
  updateAiRevenueStatus,
} from "../services/ai-revenue-agent/ai-revenue-agent.service.js";
import { classifyAiRevenueReply, type AiRevenueReplyIntent } from "../services/ai-revenue-agent/reply-intent.service.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";

const router = Router();

const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const queryBooleanSchema = z.preprocess((value) => {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return value;
}, z.boolean());

const actionQuerySchema = z.object({
  clinicId: z.string().min(1),
  dateKey: dateKeySchema.optional(),
  dueDateKey: dateKeySchema.optional(),
  dueStartDateKey: dateKeySchema.optional(),
  dueEndDateKey: dateKeySchema.optional(),
  status: z.enum(aiRevenueActionStatuses).optional(),
  source: z.enum(aiRevenueActionSources).optional(),
  actionType: z.enum(aiRevenueActionTypes).optional(),
  workflowState: z.enum(aiRevenueWorkflowStates).optional(),
  visibilityState: z.enum(aiRevenueVisibilityStates).optional(),
  assignedToUserId: z.string().min(1).optional(),
  lastContactResult: z.enum(aiRevenueContactResults).optional(),
  queueView: z.enum(["today", "overdue", "tomorrow", "next_7_days", "all_open", "completed", "suppressed"]).optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  includeResolved: queryBooleanSchema.optional(),
  includeHidden: queryBooleanSchema.optional(),
});

const actionDetailQuerySchema = z.object({
  clinicId: z.string().min(1),
});

const generateSchema = z.object({
  clinicId: z.string().min(1),
  clinicCode: z.string().min(1),
  dateKey: dateKeySchema.optional(),
  forceRefresh: z.boolean().optional(),
});

const generationStatusQuerySchema = z.object({
  clinicId: z.string().min(1),
  dateKey: dateKeySchema,
});

const generateMessageSchema = z.object({
  clinicId: z.string().min(1),
  draftText: z.string().max(1200).nullable().optional(),
});

const approveMessageSchema = z.object({
  clinicId: z.string().min(1),
  approvedText: z.string().min(1).max(1200),
});

const rejectSchema = z.object({
  clinicId: z.string().min(1),
  note: z.string().max(500).optional(),
});

const resolveSchema = z.object({
  clinicId: z.string().min(1),
  reason: z.enum(aiRevenueResolutionReasons),
  note: z.string().max(1000).nullable().optional(),
  suppressCustomer: z.boolean().optional(),
  permanentSuppression: z.boolean().optional(),
  suppressUntil: dateKeySchema.nullable().optional(),
  snoozeDays: z.number().int().min(1).max(365).optional(),
  scope: z.enum(aiRevenueSuppressionScopes).optional(),
});

const markSentSchema = z.object({
  clinicId: z.string().min(1),
  channel: z.string().min(1).max(60).default("manual"),
  messageText: z.string().max(1200).optional(),
  providerMessageId: z.string().max(240).nullable().optional(),
  sentAt: z.string().max(80).optional(),
});

const recordReplySchema = z.object({
  clinicId: z.string().min(1),
  channel: z.string().min(1).max(60).default("manual"),
  replyText: z.string().max(1200).optional(),
  messageText: z.string().max(1200).optional(),
  providerMessageId: z.string().max(240).nullable().optional(),
  receivedAt: z.string().max(80).optional(),
  inboundAt: z.string().max(80).optional(),
});

const followUpAttemptSchema = z.object({
  clinicId: z.string().min(1),
  channel: z.enum(aiRevenueFollowUpChannels),
  result: z.enum(aiRevenueFollowUpResults),
  note: z.string().max(2000).nullable().optional(),
  contactedAt: z.string().max(80).nullable().optional(),
  scheduleOption: z.enum(aiRevenueFollowUpScheduleOptions).default("none"),
  nextFollowUpDate: dateKeySchema.nullable().optional(),
  suppressionScope: z.enum(aiRevenueSuppressionScopes).nullable().optional(),
  bookingId: z.string().max(120).nullable().optional(),
  appointmentDateTime: z.string().max(80).nullable().optional(),
  treatmentCompletedAt: z.string().max(80).nullable().optional(),
  packageSessionUsedAt: z.string().max(80).nullable().optional(),
  packageSessionsRecovered: z.number().min(0).nullable().optional(),
  repurchaseInvoiceNumber: z.string().max(120).nullable().optional(),
  repurchaseRevenue: z.number().min(0).nullable().optional(),
  revenueAttributedAt: z.string().max(80).nullable().optional(),
});

const workflowFollowUpAppointmentSchema = z.object({
  bookingId: z.string().max(120).nullable().optional(),
  appointmentDateTime: z.string().max(80).nullable().optional(),
  serviceId: z.string().max(120).nullable().optional(),
  serviceName: z.string().max(240).nullable().optional(),
  practitionerId: z.string().max(120).nullable().optional(),
  practitionerName: z.string().max(240).nullable().optional(),
  note: z.string().max(1200).nullable().optional(),
});

const workflowFollowUpOutcomeSchema = z.object({
  outcomeType: z.enum(aiRevenueOutcomeTypes).optional(),
  bookingId: z.string().max(120).nullable().optional(),
  treatmentId: z.string().max(120).nullable().optional(),
  orderId: z.string().max(120).nullable().optional(),
  invoiceNumber: z.string().max(120).nullable().optional(),
  serviceId: z.string().max(120).nullable().optional(),
  serviceName: z.string().max(240).nullable().optional(),
  revenueAmount: z.number().min(0).nullable().optional(),
  packageSessionsRecovered: z.number().min(0).nullable().optional(),
  attributionType: z.enum(aiRevenueAttributionTypes).optional(),
  eventAt: z.string().max(80).nullable().optional(),
});

const workflowFollowUpAttemptSchema = z.object({
  clinicId: z.string().min(1),
  channel: z.enum(aiRevenueContactChannels),
  result: z.enum(aiRevenueContactResults),
  note: z.string().max(2000).nullable().optional(),
  messageText: z.string().max(1200).nullable().optional(),
  nextFollowUpAt: z.string().max(80).nullable().optional(),
  nextFollowUpDateKey: dateKeySchema.nullable().optional(),
  suppressCustomer: z.boolean().optional(),
  suppressionScope: z.enum(aiRevenueSuppressionScopes).optional(),
  suppressionUntil: dateKeySchema.nullable().optional(),
  permanentSuppression: z.boolean().optional(),
  appointment: workflowFollowUpAppointmentSchema.nullable().optional(),
  outcome: workflowFollowUpOutcomeSchema.nullable().optional(),
});

const contactAttemptQuerySchema = z.object({
  clinicId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const outcomeLinkQuerySchema = z.object({
  clinicId: z.string().min(1),
  actionId: z.string().max(160).optional(),
  outcomeType: z.enum(aiRevenueOutcomeTypes).optional(),
  startDateKey: dateKeySchema.optional(),
  endDateKey: dateKeySchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const outcomeLinkCreateSchema = z.object({
  clinicId: z.string().min(1),
  actionId: z.string().max(160),
  outcomeType: z.enum(aiRevenueOutcomeTypes),
  contactAttemptId: z.string().max(160).nullable().optional(),
  bookingId: z.string().max(120).nullable().optional(),
  treatmentId: z.string().max(120).nullable().optional(),
  orderId: z.string().max(120).nullable().optional(),
  invoiceNumber: z.string().max(120).nullable().optional(),
  serviceId: z.string().max(120).nullable().optional(),
  serviceName: z.string().max(240).nullable().optional(),
  revenueAmount: z.number().min(0).nullable().optional(),
  packageSessionsRecovered: z.number().min(0).nullable().optional(),
  attributionType: z.enum(aiRevenueAttributionTypes).nullable().optional(),
  attributionWindowDays: z.number().int().min(1).max(365).nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  eventAt: z.string().max(80).nullable().optional(),
});

const appointmentUpdateTypes = [
  "appointment_confirmed",
  "reminder_sent",
  "customer_came",
  "cancelled",
  "no_show",
  "completed",
  "sync_outcome",
] as const;

const appointmentPatchSchema = z.object({
  clinicId: z.string().min(1),
  updateType: z.enum(appointmentUpdateTypes).optional(),
  syncOutcome: z.boolean().optional(),
  bookingId: z.string().max(120).nullable().optional(),
  appointmentDateTime: z.string().max(80).nullable().optional(),
  bookingStatus: z.string().max(80).nullable().optional(),
  reminderSentAt: z.string().max(80).nullable().optional(),
  cameAt: z.string().max(80).nullable().optional(),
  cancelledAt: z.string().max(80).nullable().optional(),
  noShowAt: z.string().max(80).nullable().optional(),
  completedAt: z.string().max(80).nullable().optional(),
  reminderTemplateType: z.enum(["immediate_confirmation", "one_day_before", "same_day", "no_show_recovery"]).optional(),
  status: z.enum(aiRevenueActionStatuses).optional(),
});

const bookingRequestSchema = z.object({
  clinicId: z.string().min(1),
  requestedDateTime: z.string().max(80).nullable().optional(),
  serviceId: z.string().max(120).nullable().optional(),
  serviceName: z.string().max(240).nullable().optional(),
  practitionerId: z.string().max(120).nullable().optional(),
  practitionerName: z.string().max(240).nullable().optional(),
  note: z.string().max(1200).nullable().optional(),
  mode: z.enum(["direct_booking", "booking_request"]).default("booking_request"),
});

const revenuePatchSchema = z.object({
  clinicId: z.string().min(1),
  actualRevenue: z.number().min(0).nullable().optional(),
  influencedRevenue: z.number().min(0).nullable().optional(),
  packageSessionsRecovered: z.number().min(0).nullable().optional(),
  orderId: z.string().max(120).nullable().optional(),
  invoiceNumber: z.string().max(120).nullable().optional(),
  attributionType: z.enum(aiRevenueAttributionTypes).optional(),
  revenueAt: z.string().max(80).nullable().optional(),
  revenueNote: z.string().max(1200).nullable().optional(),
});

const revenueSyncSchema = z.object({
  clinicId: z.string().min(1),
  clinicCode: z.string().min(1).nullable().optional(),
  attributionWindowDays: z.number().int().min(1).max(60).optional(),
});

const summaryQuerySchema = z.object({
  clinicId: z.string().min(1),
  startDateKey: dateKeySchema.optional(),
  endDateKey: dateKeySchema.optional(),
  status: z.enum(aiRevenueActionStatuses).optional(),
  source: z.enum(aiRevenueActionSources).optional(),
  actionType: z.enum(aiRevenueActionTypes).optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
});

const auditLogQuerySchema = z.object({
  clinicId: z.string().min(1),
  actionId: z.string().optional(),
  actorType: z.enum(["ai", "staff", "customer", "system"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const suppressionQuerySchema = z.object({
  clinicId: z.string().min(1),
  includeInactive: queryBooleanSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const suppressionLiftSchema = z.object({
  clinicId: z.string().min(1),
});

const settingsSchema = z.object({
  clinicId: z.string().min(1),
  clinicCode: z.string().min(1).nullable().optional(),
  clinicName: z.string().min(1).nullable().optional(),
  aiRevenueAgentEnabled: z.boolean().optional(),
  autoGenerateTodayOpportunities: z.boolean().optional(),
  timezone: z.string().min(1).max(80).optional(),
  dailyGenerateTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  runOrder: z.number().int().min(0).max(10_000).optional(),
  language: z.enum(["my-MM", "en-US"]).optional(),
  messagingMode: z.enum(["manual", "mock", "provider"]).optional(),
  approvalRequired: z.boolean().optional(),
  attributionWindowDays: z.number().int().min(1).max(365).optional(),
  maxActionsPerRun: z.number().int().min(1).max(500).optional(),
});

type AiRevenueSettingsPayload = z.infer<typeof settingsSchema>;

const settingsPatchFields = [
  "clinicCode",
  "clinicName",
  "aiRevenueAgentEnabled",
  "autoGenerateTodayOpportunities",
  "timezone",
  "dailyGenerateTime",
  "runOrder",
  "language",
  "messagingMode",
  "approvalRequired",
  "attributionWindowDays",
  "maxActionsPerRun",
] as const satisfies ReadonlyArray<keyof AiRevenueSettingsPayload & keyof AiRevenueSettings>;

export function buildAiRevenueSettingsPatch(params: AiRevenueSettingsPayload): Partial<AiRevenueSettings> {
  const patch: Partial<AiRevenueSettings> = {};

  for (const field of settingsPatchFields) {
    const value = params[field];
    if (value !== undefined) {
      (patch as Record<string, unknown>)[field] = value;
    }
  }

  return patch;
}

function actionId(req: { params: { actionId?: string | string[] } }) {
  const value = req.params.actionId;
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

function replyStatus(intent: AiRevenueReplyIntent, actionType?: string | null): AiRevenueActionStatus {
  if (intent === "not_interested") {
    return "not_interested";
  }

  if (intent === "cancel" || intent === "reschedule") {
    return actionType === "appointment_confirmation_reminder" ? "customer_replied" : "human_takeover";
  }

  if (intent === "price_question" || intent === "call_request" || intent === "complaint" || intent === "unclear") {
    return "human_takeover";
  }

  return "customer_replied";
}

router.use(verifyFirebaseToken);

router.get(
  "/actions",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = actionQuerySchema.parse(req.query);
    const data = await listAiRevenueActions(params);

    res.json({ success: true, data });
  }),
);

router.get(
  "/actions/:actionId",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = actionDetailQuerySchema.parse(req.query);
    const action = await getAiRevenueAction({
      clinicId: params.clinicId,
      actionId: actionId(req),
    });

    res.json({ success: true, data: { action } });
  }),
);

router.post(
  "/generate",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = generateSchema.parse(req.body);
    const data = await generateAiRevenueActionsOnce({
      clinicId: params.clinicId,
      clinicCode: params.clinicCode,
      dateKey: params.dateKey,
      forceRefresh: params.forceRefresh,
      authorizationHeader: req.headers.authorization,
    });

    res.json({ success: true, data });
  }),
);

router.get(
  "/generation-status",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = generationStatusQuerySchema.parse(req.query);
    const generation = await getAiRevenueGenerationStatus(params);

    res.json({ success: true, data: { generation } });
  }),
);

router.post(
  "/actions/:actionId/generate-message",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = generateMessageSchema.parse(req.body);
    const action = await generateAiRevenueMessage({
      clinicId: params.clinicId,
      actionId: actionId(req),
      draftText: params.draftText,
      user: req.user,
    });

    res.json({ success: true, data: { action } });
  }),
);

router.post(
  "/actions/:actionId/approve-message",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = approveMessageSchema.parse(req.body);
    const action = await approveAiRevenueMessage({
      clinicId: params.clinicId,
      actionId: actionId(req),
      approvedText: params.approvedText,
      user: req.user,
    });

    res.json({ success: true, data: { action } });
  }),
);

router.post(
  "/actions/:actionId/reject",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = rejectSchema.parse(req.body);
    const action = await updateAiRevenueStatus({
      clinicId: params.clinicId,
      actionId: actionId(req),
      status: "closed",
      user: req.user,
      auditAction: "message_rejected",
      auditDescription: params.note || "Staff rejected AI Revenue action/message.",
    });

    res.json({ success: true, data: { action } });
  }),
);

router.post(
  "/actions/:actionId/resolve",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = resolveSchema.parse(req.body);
    const action = await resolveAiRevenueAction({
      clinicId: params.clinicId,
      actionId: actionId(req),
      reason: params.reason,
      note: params.note,
      suppressCustomer: params.suppressCustomer,
      permanentSuppression: params.permanentSuppression,
      suppressUntil: params.suppressUntil,
      snoozeDays: params.snoozeDays,
      scope: params.scope,
      user: req.user,
    });

    res.json({ success: true, data: { action } });
  }),
);

router.post(
  "/actions/:actionId/mark-sent",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = markSentSchema.parse(req.body);
    const current = await getAiRevenueAction({
      clinicId: params.clinicId,
      actionId: actionId(req),
    });
    const finalMessageText = params.messageText?.trim() || current.message.approvedText?.trim() || "";
    if (current.status !== "approved") {
      throw new HttpError(400, "AI Revenue message must be approved before it can be marked as sent.");
    }
    if (!finalMessageText) {
      throw new HttpError(400, "Approved message text is required before marking as sent.");
    }

    const sentAt = params.sentAt ?? new Date().toISOString();
    const action = await updateAiRevenueMessage({
      clinicId: params.clinicId,
      actionId: actionId(req),
      status: "sent",
      user: req.user,
      auditAction: "message_marked_sent",
      auditDescription: "Staff manually marked approved AI Revenue message as sent.",
      patch: {
        channel: params.channel,
        sentAt,
        providerMessageId: params.providerMessageId ?? null,
      },
    });
    const event = await createAiRevenueMessageEvent({
      clinicId: params.clinicId,
      actionId: actionId(req),
      memberId: action.customer.memberId,
      channel: params.channel,
      direction: "outbound",
      messageText: finalMessageText,
      providerMessageId: params.providerMessageId ?? null,
      createdAt: sentAt,
      user: req.user,
    });

    res.json({ success: true, data: { action, event } });
  }),
);

router.post(
  "/actions/:actionId/record-reply",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = recordReplySchema.parse(req.body);
    const replyText = (params.replyText ?? params.messageText ?? "").trim();
    if (!replyText) {
      throw new HttpError(400, "Reply text is required.");
    }

    const current = await getAiRevenueAction({
      clinicId: params.clinicId,
      actionId: actionId(req),
    });
    const classified = classifyAiRevenueReply(replyText);
    const inboundAt = params.receivedAt ?? params.inboundAt ?? new Date().toISOString();
    const action = await updateAiRevenueMessage({
      clinicId: params.clinicId,
      actionId: actionId(req),
      status: replyStatus(classified.intent, current.actionType),
      user: req.user,
      auditAction: "customer_reply_recorded",
      auditDescription: `Customer reply recorded and classified as ${classified.intent}.`,
      patch: {
        channel: params.channel,
        lastInboundText: replyText,
        lastInboundIntent: classified.intent,
        lastInboundAt: inboundAt,
      },
    });
    const event = await createAiRevenueMessageEvent({
      clinicId: params.clinicId,
      actionId: actionId(req),
      memberId: action.customer.memberId,
      channel: params.channel,
      direction: "inbound",
      messageText: replyText,
      intent: classified.intent,
      confidence: classified.confidence,
      providerMessageId: params.providerMessageId ?? null,
      createdAt: inboundAt,
      user: req.user,
    });

    res.json({ success: true, data: { action, event, intent: classified.intent, confidence: classified.confidence } });
  }),
);

router.post(
  "/actions/:actionId/record-follow-up",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = followUpAttemptSchema.parse(req.body);
    if (params.scheduleOption === "custom" && !params.nextFollowUpDate) {
      throw new HttpError(400, "Custom next follow-up date is required.");
    }

    const data = await recordAiRevenueFollowUpAttempt({
      clinicId: params.clinicId,
      actionId: actionId(req),
      channel: params.channel,
      result: params.result,
      note: params.note,
      contactedAt: params.contactedAt,
      scheduleOption: params.scheduleOption,
      nextFollowUpDate: params.nextFollowUpDate,
      suppressionScope: params.suppressionScope,
      bookingId: params.bookingId,
      appointmentDateTime: params.appointmentDateTime,
      treatmentCompletedAt: params.treatmentCompletedAt,
      packageSessionUsedAt: params.packageSessionUsedAt,
      packageSessionsRecovered: params.packageSessionsRecovered,
      repurchaseInvoiceNumber: params.repurchaseInvoiceNumber,
      repurchaseRevenue: params.repurchaseRevenue,
      revenueAttributedAt: params.revenueAttributedAt,
      user: req.user,
    });

    res.json({ success: true, data });
  }),
);

router.post(
  "/actions/:actionId/follow-up-attempt",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = workflowFollowUpAttemptSchema.parse(req.body);
    const data = await recordAiRevenueFollowUpAttempt({
      clinicId: params.clinicId,
      actionId: actionId(req),
      channel: params.channel,
      result: params.result,
      note: params.note,
      messageText: params.messageText,
      nextFollowUpAt: params.nextFollowUpAt,
      nextFollowUpDateKey: params.nextFollowUpDateKey,
      suppressCustomer: params.suppressCustomer,
      suppressionScope: params.suppressionScope,
      suppressionUntil: params.suppressionUntil,
      permanentSuppression: params.permanentSuppression,
      appointment: params.appointment ?? undefined,
      outcome: params.outcome ?? undefined,
      actor: getActorFromUser(req.user),
    });

    res.json({
      success: true,
      data: {
        action: data.action,
        attempt: data.attempt,
        timelineEvent: data.timelineEvent,
        suppression: data.suppression ?? null,
        outcomeLink: data.outcomeLink ?? null,
      },
    });
  }),
);

router.get(
  "/actions/:actionId/follow-up-attempts",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = contactAttemptQuerySchema.parse(req.query);
    const attempts = await listAiRevenueContactAttempts({
      clinicId: params.clinicId,
      actionId: actionId(req),
      limit: params.limit,
    });

    res.json({ success: true, data: { attempts } });
  }),
);

router.post(
  "/actions/:actionId/request-booking",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = bookingRequestSchema.parse(req.body);
    const action = await requestAiRevenueBooking({
      clinicId: params.clinicId,
      actionId: actionId(req),
      requestedDateTime: params.requestedDateTime,
      serviceId: params.serviceId,
      serviceName: params.serviceName,
      practitionerId: params.practitionerId,
      practitionerName: params.practitionerName,
      note: params.note,
      mode: params.mode,
      user: req.user,
    });

    res.json({ success: true, data: { action } });
  }),
);

router.post(
  "/actions/:actionId/update-appointment",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = appointmentPatchSchema.parse(req.body);
    if (params.syncOutcome || params.updateType === "sync_outcome") {
      const action = await syncAiRevenueAppointmentOutcome({
        clinicId: params.clinicId,
        actionId: actionId(req),
        authorizationHeader: req.headers.authorization,
        user: req.user,
      });

      res.json({ success: true, data: { action } });
      return;
    }

    const status = params.updateType ?? params.status;
    const action = await updateAiRevenueAppointment({
      clinicId: params.clinicId,
      actionId: actionId(req),
      status,
      reminderTemplateType: params.reminderTemplateType,
      user: req.user,
      patch: {
        bookingId: params.bookingId,
        appointmentDateTime: params.appointmentDateTime,
        bookingStatus: params.bookingStatus,
        reminderSentAt: params.reminderSentAt,
        cameAt: params.cameAt,
        cancelledAt: params.cancelledAt,
        noShowAt: params.noShowAt,
        completedAt: params.completedAt,
      },
    });

    res.json({ success: true, data: { action } });
  }),
);

router.post(
  "/actions/:actionId/record-revenue",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = revenuePatchSchema.parse(req.body);
    const action = await updateAiRevenueRevenue({
      clinicId: params.clinicId,
      actionId: actionId(req),
      user: req.user,
      patch: {
        actualRevenue: params.actualRevenue,
        influencedRevenue: params.influencedRevenue,
        packageSessionsRecovered: params.packageSessionsRecovered,
        orderId: params.orderId,
        invoiceNumber: params.invoiceNumber,
        attributionType: params.attributionType,
        revenueAt: params.revenueAt,
        revenueNote: params.revenueNote,
      },
    });

    res.json({ success: true, data: { action } });
  }),
);

router.post(
  "/actions/:actionId/sync-revenue",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = revenueSyncSchema.parse(req.body);
    const action = await syncAiRevenueRevenue({
      clinicId: params.clinicId,
      actionId: actionId(req),
      clinicCode: params.clinicCode,
      attributionWindowDays: params.attributionWindowDays,
      authorizationHeader: req.headers.authorization,
      user: req.user,
    });

    res.json({ success: true, data: { action } });
  }),
);

router.post(
  "/outcome-links",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = outcomeLinkCreateSchema.parse(req.body);
    const outcomeLink = await createAiRevenueOutcomeLink({
      clinicId: params.clinicId,
      actionId: params.actionId,
      outcomeType: params.outcomeType,
      contactAttemptId: params.contactAttemptId,
      bookingId: params.bookingId,
      treatmentId: params.treatmentId,
      orderId: params.orderId,
      invoiceNumber: params.invoiceNumber,
      serviceId: params.serviceId,
      serviceName: params.serviceName,
      revenueAmount: params.revenueAmount,
      packageSessionsRecovered: params.packageSessionsRecovered,
      attributionType: params.attributionType,
      attributionWindowDays: params.attributionWindowDays,
      confidence: params.confidence,
      eventAt: params.eventAt,
      user: req.user,
    });

    res.json({ success: true, data: { outcomeLink } });
  }),
);

router.get(
  "/outcome-links",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = outcomeLinkQuerySchema.parse(req.query);
    const outcomeLinks = await listAiRevenueOutcomeLinks({
      clinicId: params.clinicId,
      actionId: params.actionId,
      outcomeType: params.outcomeType,
      startDateKey: params.startDateKey,
      endDateKey: params.endDateKey,
      limit: params.limit,
    });

    res.json({ success: true, data: { outcomeLinks } });
  }),
);

router.get(
  "/summary",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = summaryQuerySchema.parse(req.query);
    const summary = await getAiRevenueSummary(params);

    res.json({ success: true, data: { summary } });
  }),
);

router.get(
  "/audit-logs",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = auditLogQuerySchema.parse(req.query);
    const auditLogs = await listAiRevenueAuditLogs(params);

    res.json({ success: true, data: { auditLogs } });
  }),
);

router.get(
  "/suppressions",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = suppressionQuerySchema.parse(req.query);
    const suppressions = await listAiRevenueCustomerSuppressions({
      clinicId: params.clinicId,
      includeInactive: params.includeInactive,
      limit: params.limit,
    });

    res.json({ success: true, data: { suppressions } });
  }),
);

router.post(
  "/suppressions/:suppressionId/lift",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = suppressionLiftSchema.parse(req.body);
    const suppression = await liftAiRevenueCustomerSuppression({
      clinicId: params.clinicId,
      suppressionId: String(req.params.suppressionId ?? ""),
      user: req.user,
    });

    res.json({ success: true, data: { suppression } });
  }),
);

router.get(
  "/settings",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = actionDetailQuerySchema.parse(req.query);
    const settings = await getAiRevenueSettings(params.clinicId);

    res.json({ success: true, data: { settings } });
  }),
);

router.post(
  "/settings",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = settingsSchema.parse(req.body);
    const settings = await saveAiRevenueSettings({
      clinicId: params.clinicId,
      user: req.user,
      patch: buildAiRevenueSettingsPatch(params),
    });

    res.json({ success: true, data: { settings } });
  }),
);

export default router;
