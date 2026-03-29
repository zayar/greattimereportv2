import { Router } from "express";
import { z } from "zod";
import { verifyFirebaseToken } from "../middleware/auth.js";
import { requireClinicAccess } from "../middleware/clinic-access.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";
import { getTelegramBotLinkMetadata, handleTelegramWebhook, type TelegramUpdate } from "../services/telegram/bot.service.js";
import { sendTodayAppointmentReport } from "../services/telegram/report.service.js";
import {
  generateTelegramLinkCode,
  getTelegramIntegrationStatus,
  markTelegramTestSent,
  unlinkTelegramIntegration,
  updateTelegramReportSettings,
} from "../services/telegram/storage.service.js";
import { normalizeReportTime, normalizeTimeZone } from "../services/telegram/time.js";

const router = Router();

const clinicScopedBaseSchema = z.object({
  clinicId: z.string().min(1),
  clinicCode: z.string().default(""),
  clinicName: z.string().default(""),
});

const settingsSchema = clinicScopedBaseSchema.extend({
  isTodayAppointmentReportEnabled: z.boolean(),
  reportTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().min(1),
});

const sendTestSchema = clinicScopedBaseSchema.extend({
  timezone: z.string().optional(),
});

router.post(
  "/webhook",
  asyncHandler(async (req, res) => {
    await handleTelegramWebhook(req.body as TelegramUpdate, req.header("x-telegram-bot-api-secret-token") ?? undefined);

    res.json({ success: true });
  }),
);

router.use(verifyFirebaseToken);

router.get(
  "/status",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = clinicScopedBaseSchema.parse(req.query);
    const status = await getTelegramIntegrationStatus(params);
    const botMetadata = await getTelegramBotLinkMetadata(status.pendingLinkCode);

    res.json({
      success: true,
      data: {
        ...status,
        ...botMetadata,
      },
    });
  }),
);

router.post(
  "/link-code",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = clinicScopedBaseSchema.parse(req.body);
    const status = await generateTelegramLinkCode({
      ...params,
      createdByUserId: req.user?.userId,
      createdByEmail: req.user?.email,
    });
    const botMetadata = await getTelegramBotLinkMetadata(status.pendingLinkCode);

    res.json({
      success: true,
      data: {
        ...status,
        ...botMetadata,
      },
    });
  }),
);

router.post(
  "/settings",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = settingsSchema.parse(req.body);
    const status = await updateTelegramReportSettings({
      ...params,
      reportTime: normalizeReportTime(params.reportTime),
      timezone: normalizeTimeZone(params.timezone),
    });
    const botMetadata = await getTelegramBotLinkMetadata(status.pendingLinkCode);

    res.json({
      success: true,
      data: {
        ...status,
        ...botMetadata,
      },
    });
  }),
);

router.post(
  "/unlink",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = clinicScopedBaseSchema.pick({ clinicId: true }).parse(req.body);
    const status = await unlinkTelegramIntegration(params);
    const botMetadata = await getTelegramBotLinkMetadata(null);

    res.json({
      success: true,
      data: {
        ...status,
        ...botMetadata,
      },
    });
  }),
);

router.post(
  "/send-test",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = sendTestSchema.parse(req.body);
    const status = await getTelegramIntegrationStatus(params);

    if (!status.telegramChatId) {
      throw new HttpError(400, "Link Telegram first before sending a test report.");
    }

    const sent = await sendTodayAppointmentReport({
      chatId: status.telegramChatId,
      clinicCode: status.clinicCode || params.clinicCode,
      clinicName: status.clinicName || params.clinicName,
      timezone: normalizeTimeZone(params.timezone ?? status.timezone),
      authorizationHeader: req.headers.authorization,
    });

    await markTelegramTestSent(params.clinicId, sent.sentAt);

    res.json({
      success: true,
      data: {
        sentAt: sent.sentAt,
        appointmentCount: sent.report.totalAppointments,
      },
    });
  }),
);

export default router;
