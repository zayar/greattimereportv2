import { Router } from "express";
import { z } from "zod";
import {
  gtGrowthAiSalesActionTypes,
  gtGrowthAiSalesActionStatuses,
  gtGrowthAiSalesActionUpdateStatuses,
  gtGrowthAiTelegramTargetPurposes,
} from "../types/gt-growth-ai-sales-assistant.js";
import { verifyFirebaseToken } from "../middleware/auth.js";
import { requireClinicAccess } from "../middleware/clinic-access.js";
import {
  buildSalesAssistantSendPlan,
  createTelegramTaskSession,
  generateSalesAssistantActions,
  getSalesAssistantActionsResponse,
  getSalesAssistantProgress,
  markSalesAssistantActionsAssigned,
  normalizeSalesAssistantDateKey,
  requireSalesAssistantPremium,
  updateSalesAssistantActionStatus,
} from "../services/gt-growth-ai/sales-assistant.service.js";
import { sendTelegramMessage } from "../services/telegram/bot.service.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";

const router = Router();

const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const salesAssistantQuerySchema = z.object({
  clinicId: z.string().min(1),
  dateKey: dateKeySchema.optional(),
  status: z.enum(gtGrowthAiSalesActionStatuses).optional(),
  actionType: z.enum(gtGrowthAiSalesActionTypes).optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
});

const generateSchema = z.object({
  clinicId: z.string().min(1),
  clinicCode: z.string().min(1),
  dateKey: dateKeySchema.optional(),
  forceRefresh: z.boolean().default(false),
});

const sendSchema = z.object({
  clinicId: z.string().min(1),
  clinicCode: z.string().min(1),
  clinicName: z.string().optional(),
  dateKey: dateKeySchema.optional(),
  targetPurpose: z.enum(gtGrowthAiTelegramTargetPurposes).optional(),
});

const statusUpdateSchema = z.object({
  clinicId: z.string().min(1),
  status: z.enum(gtGrowthAiSalesActionUpdateStatuses),
  note: z.string().max(240).optional(),
});

function mapLockedError(error: unknown) {
  if (error instanceof Error && error.name === "GtGrowthAiLocked") {
    throw new HttpError(403, error.message);
  }

  throw error;
}

router.use(verifyFirebaseToken);

router.get(
  "/sales-assistant/actions",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = salesAssistantQuerySchema.parse(req.query);
    const dateKey = normalizeSalesAssistantDateKey(params.dateKey);
    const data = await getSalesAssistantActionsResponse({
      clinicId: params.clinicId,
      dateKey,
      status: params.status,
      actionType: params.actionType,
      priority: params.priority,
    });

    res.json({ success: true, data });
  }),
);

router.post(
  "/sales-assistant/generate",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = generateSchema.parse(req.body);
    const dateKey = normalizeSalesAssistantDateKey(params.dateKey);

    try {
      const premium = await requireSalesAssistantPremium(params.clinicId);
      const actions = await generateSalesAssistantActions({
        clinicId: params.clinicId,
        clinicCode: params.clinicCode,
        dateKey,
        forceRefresh: params.forceRefresh,
        authorizationHeader: req.headers.authorization,
      });
      const data = await getSalesAssistantActionsResponse({
        clinicId: params.clinicId,
        dateKey,
      });

      res.json({
        success: true,
        data: {
          ...data,
          premium,
          generatedCount: actions.length,
        },
      });
    } catch (error) {
      mapLockedError(error);
    }
  }),
);

router.post(
  "/sales-assistant/send",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = sendSchema.parse(req.body);
    const dateKey = normalizeSalesAssistantDateKey(params.dateKey);

    try {
      await requireSalesAssistantPremium(params.clinicId);
      const plan = await buildSalesAssistantSendPlan({
        clinicId: params.clinicId,
        clinicCode: params.clinicCode,
        clinicName: params.clinicName,
        dateKey,
        targetPurpose: params.targetPurpose,
        authorizationHeader: req.headers.authorization,
      });

      if (!plan.salesTarget?.telegramChatId || !plan.salesMessage) {
        throw new HttpError(400, "No linked sales lead Telegram target was found.");
      }

      await sendTelegramMessage(plan.salesTarget.telegramChatId, plan.salesMessage);
      const assigned = await markSalesAssistantActionsAssigned({
        clinicId: params.clinicId,
        actions: plan.actions,
        target: plan.salesTarget,
      });
      await createTelegramTaskSession({
        clinicId: params.clinicId,
        chatId: plan.salesTarget.telegramChatId,
        dateKey,
        actions: assigned,
      });

      if (plan.ownerTarget?.telegramChatId && plan.ownerMessage) {
        await sendTelegramMessage(plan.ownerTarget.telegramChatId, plan.ownerMessage);
      }

      res.json({
        success: true,
        data: {
          dateKey,
          sentToSalesLead: true,
          salesTargetLabel: plan.salesTarget.targetLabel,
          sentOwnerSummary: Boolean(plan.ownerTarget?.telegramChatId && plan.ownerMessage),
          ownerTargetLabel: plan.ownerTarget?.targetLabel ?? null,
          summary: plan.summary,
          actionCount: assigned.length,
        },
      });
    } catch (error) {
      mapLockedError(error);
    }
  }),
);

router.post(
  "/sales-assistant/actions/:actionId/status",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = statusUpdateSchema.parse(req.body);

    try {
      await requireSalesAssistantPremium(params.clinicId);
      const action = await updateSalesAssistantActionStatus({
        clinicId: params.clinicId,
        actionId: String(req.params.actionId ?? ""),
        status: params.status,
        note: params.note,
        updatedByTelegramUserId: req.user?.userId ?? req.user?.uid ?? null,
      });

      res.json({ success: true, data: { action } });
    } catch (error) {
      mapLockedError(error);
    }
  }),
);

router.get(
  "/sales-assistant/progress",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = salesAssistantQuerySchema.pick({ clinicId: true, dateKey: true }).parse(req.query);
    const dateKey = normalizeSalesAssistantDateKey(params.dateKey);

    try {
      await requireSalesAssistantPremium(params.clinicId);
      const data = await getSalesAssistantProgress({
        clinicId: params.clinicId,
        dateKey,
      });

      res.json({ success: true, data });
    } catch (error) {
      mapLockedError(error);
    }
  }),
);

export default router;
