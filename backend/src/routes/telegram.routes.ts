import { Router } from "express";
import { z } from "zod";
import { verifyFirebaseToken } from "../middleware/auth.js";
import { requireClinicAccess } from "../middleware/clinic-access.js";
import { sendTrackedTelegramReport } from "../services/telegram/delivery.service.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";
import { getTelegramBotLinkMetadata, handleTelegramWebhook, type TelegramUpdate } from "../services/telegram/bot.service.js";
import {
  generateTelegramLinkCode,
  getTelegramIntegrationStatus,
  unlinkTelegramIntegration,
  updateTelegramReportSettings,
} from "../services/telegram/storage.service.js";
import { normalizeReportTime, normalizeTimeZone } from "../services/telegram/time.js";
import type { TelegramReportType } from "../services/telegram/types.js";

const router = Router();

const clinicScopedBaseSchema = z.object({
  clinicId: z.string().min(1),
  clinicCode: z.string().default(""),
  clinicName: z.string().default(""),
});

const clinicTargetSchema = clinicScopedBaseSchema.extend({
  chatId: z.string().min(1),
});

const settingsSchema = clinicTargetSchema.extend({
  isTodayAppointmentReportEnabled: z.boolean(),
  reportTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  isTodayPaymentReportEnabled: z.boolean(),
  paymentReportTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().min(1),
});

const sendTestSchema = clinicTargetSchema.extend({
  reportType: z.enum(["appointment", "payment"]).default("appointment"),
  timezone: z.string().optional(),
});

const resendSchema = sendTestSchema;

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
      paymentReportTime: normalizeReportTime(params.paymentReportTime),
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
    const params = clinicTargetSchema.pick({ clinicId: true, chatId: true }).parse(req.body);
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
    const target = status.linkedTargets.find((item) => item.telegramChatId === params.chatId);

    if (!target?.telegramChatId) {
      throw new HttpError(400, "Link Telegram first before sending a test report.");
    }

    const reportType = params.reportType as TelegramReportType;
    const timezone = normalizeTimeZone(params.timezone ?? target.timezone);
    const sent = await sendTrackedTelegramReport({
      clinicId: target.clinicId || params.clinicId,
      clinicCode: target.clinicCode || params.clinicCode,
      clinicName: target.clinicName || params.clinicName,
      chatId: target.telegramChatId,
      reportType,
      trigger: "manual_test",
      timezone,
      authorizationHeader: req.headers.authorization,
    });

    res.json({
      success: true,
      data: {
        sentAt: sent.sentAt,
        reportType,
        appointmentCount: "totalAppointments" in sent.report ? sent.report.totalAppointments : undefined,
        paymentCount: "paymentCount" in sent.report ? sent.report.paymentCount : undefined,
        totalPaymentAmount: "totalPaymentAmount" in sent.report ? sent.report.totalPaymentAmount : undefined,
      },
    });
  }),
);

router.post(
  "/resend",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = resendSchema.parse(req.body);
    const status = await getTelegramIntegrationStatus(params);
    const target = status.linkedTargets.find((item) => item.telegramChatId === params.chatId);

    if (!target?.telegramChatId) {
      throw new HttpError(400, "Link Telegram first before resending a report.");
    }

    const reportType = params.reportType as TelegramReportType;
    const timezone = normalizeTimeZone(params.timezone ?? target.timezone);
    const sent = await sendTrackedTelegramReport({
      clinicId: target.clinicId || params.clinicId,
      clinicCode: target.clinicCode || params.clinicCode,
      clinicName: target.clinicName || params.clinicName,
      chatId: target.telegramChatId,
      reportType,
      trigger: "resend",
      timezone,
      authorizationHeader: req.headers.authorization,
    });

    res.json({
      success: true,
      data: {
        sentAt: sent.sentAt,
        reportType,
        appointmentCount: "totalAppointments" in sent.report ? sent.report.totalAppointments : undefined,
        paymentCount: "paymentCount" in sent.report ? sent.report.paymentCount : undefined,
        totalPaymentAmount: "totalPaymentAmount" in sent.report ? sent.report.totalPaymentAmount : undefined,
      },
    });
  }),
);

export default router;
