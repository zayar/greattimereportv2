import { Router } from "express";
import { z } from "zod";
import { verifyFirebaseToken } from "../middleware/auth.js";
import { requireClinicAccess } from "../middleware/clinic-access.js";
import {
  type AiRevenueActionStatus,
  aiRevenueActionSources,
  aiRevenueActionStatuses,
  aiRevenueActionTypes,
  aiRevenueAttributionTypes,
} from "../types/ai-revenue-agent.js";
import {
  createAiRevenueMessageEvent,
  generateAiRevenueActions,
  generateAiRevenueMessage,
  getAiRevenueAction,
  getAiRevenueSettings,
  getAiRevenueSummary,
  listAiRevenueActions,
  listAiRevenueAuditLogs,
  approveAiRevenueMessage,
  requestAiRevenueBooking,
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

const actionQuerySchema = z.object({
  clinicId: z.string().min(1),
  dateKey: dateKeySchema.optional(),
  status: z.enum(aiRevenueActionStatuses).optional(),
  source: z.enum(aiRevenueActionSources).optional(),
  actionType: z.enum(aiRevenueActionTypes).optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
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

const settingsSchema = z.object({
  clinicId: z.string().min(1),
  language: z.enum(["my-MM", "en-US"]).optional(),
  messagingMode: z.enum(["manual", "mock", "provider"]).optional(),
  approvalRequired: z.boolean().optional(),
  attributionWindowDays: z.number().int().min(1).max(365).optional(),
  maxActionsPerRun: z.number().int().min(1).max(500).optional(),
});

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
    const data = await generateAiRevenueActions({
      clinicId: params.clinicId,
      clinicCode: params.clinicCode,
      dateKey: params.dateKey,
      forceRefresh: params.forceRefresh,
      authorizationHeader: req.headers.authorization,
    });

    res.json({ success: true, data });
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
      patch: {
        language: params.language,
        messagingMode: params.messagingMode,
        approvalRequired: params.approvalRequired,
        attributionWindowDays: params.attributionWindowDays,
        maxActionsPerRun: params.maxActionsPerRun,
      },
    });

    res.json({ success: true, data: { settings } });
  }),
);

export default router;
