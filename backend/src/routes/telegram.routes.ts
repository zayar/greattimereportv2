import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "../config/env.js";
import { verifyFirebaseToken } from "../middleware/auth.js";
import { requireClinicAccess } from "../middleware/clinic-access.js";
import { sendTrackedTelegramReport } from "../services/telegram/delivery.service.js";
import { runTelegramSchedulerOnce } from "../services/telegram/runtime.service.js";
import { runScheduledAiRevenueGeneration } from "../services/ai-revenue-agent/scheduled-generation.service.js";
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
import {
  ownerAiReportFocusAreas,
  ownerAiReportTones,
  weeklySummaryDaysOfWeek,
  weeklySummarySections,
} from "../services/telegram/types.js";
import { gtGrowthAiTelegramTargetPurposes } from "../types/gt-growth-ai-sales-assistant.js";
import type { TelegramReportType } from "../services/telegram/types.js";

const router = Router();

function isSecretMatch(provided: string, expected: string) {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

const clinicScopedBaseSchema = z.object({
  clinicId: z.string().min(1),
  clinicCode: z.string().default(""),
  clinicName: z.string().default(""),
});

const clinicTargetSchema = clinicScopedBaseSchema.extend({
  chatId: z.string().min(1),
});

const telegramReportTypeSchema = z.enum(["appointment", "payment", "owner_ai", "weekly_summary"]);
const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Use a valid YYYY-MM-DD date.");

const ownerAiSettingsSchema = z.object({
  isOwnerAiReportEnabled: z.boolean().optional(),
  ownerAiReportTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  ownerAiLanguage: z.enum(["my-MM", "en-US"]).optional(),
  ownerAiTone: z.enum(ownerAiReportTones).optional(),
  ownerAiFocusAreas: z.array(z.enum(ownerAiReportFocusAreas)).min(1).max(ownerAiReportFocusAreas.length).optional(),
  ownerAiCustomInstruction: z.string().max(240).nullable().optional(),
});

const weeklySummarySettingsSchema = z.object({
  isWeeklySummaryReportEnabled: z.boolean().optional(),
  weeklySummaryReportTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  weeklySummaryDayOfWeek: z.enum(weeklySummaryDaysOfWeek).optional(),
  weeklySummarySections: z.array(z.enum(weeklySummarySections)).min(1).max(weeklySummarySections.length).optional(),
});

const gtGrowthAiSalesAssistantSettingsSchema = z.object({
  targetPurpose: z.enum(gtGrowthAiTelegramTargetPurposes).optional(),
  isGtGrowthAiSalesAssistantEnabled: z.boolean().optional(),
  gtGrowthAiSalesAssistantTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  isGtGrowthAiOwnerProgressSummaryEnabled: z.boolean().optional(),
  gtGrowthAiOwnerProgressSummaryTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
});

const agentChatSettingsSchema = z.object({
  isAgentChatEnabled: z.boolean().optional(),
  agentChatAccessMode: z.enum(["all_members", "allowed_users"]).optional(),
  agentChatAllowedUserIds: z.array(z.string().regex(/^\d{3,20}$/)).max(50).optional(),
});

const settingsSchema = clinicTargetSchema.extend({
  isTodayAppointmentReportEnabled: z.boolean(),
  reportTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  isTodayPaymentReportEnabled: z.boolean(),
  paymentReportTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().min(1),
}).merge(ownerAiSettingsSchema).merge(weeklySummarySettingsSchema).merge(gtGrowthAiSalesAssistantSettingsSchema).merge(agentChatSettingsSchema);

const sendTestSchema = clinicTargetSchema.extend({
  reportType: telegramReportTypeSchema.default("appointment"),
  timezone: z.string().optional(),
  dateKey: dateKeySchema.optional(),
}).merge(ownerAiSettingsSchema.pick({
  ownerAiLanguage: true,
  ownerAiTone: true,
  ownerAiFocusAreas: true,
  ownerAiCustomInstruction: true,
})).merge(weeklySummarySettingsSchema.pick({
  weeklySummarySections: true,
}));

const resendSchema = sendTestSchema;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function readNumber(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

function buildSendResponse(input: {
  sentAt: string;
  reportType: TelegramReportType;
  report: unknown;
}) {
  const report = isRecord(input.report) ? input.report : {};
  const appointmentReport = isRecord(report.appointmentReport) ? report.appointmentReport : {};
  const appointmentSummary = isRecord(report.appointmentSummary) ? report.appointmentSummary : {};
  const paymentReport = isRecord(report.paymentReport) ? report.paymentReport : {};
  const paymentSummary = isRecord(report.paymentSummary) ? report.paymentSummary : {};
  const aiReport = isRecord(report.aiReport) ? report.aiReport : {};

  return {
    sentAt: input.sentAt,
    reportType: input.reportType,
    dateKey: typeof report.dateKey === "string" ? report.dateKey : undefined,
    appointmentCount:
      readNumber(report.totalAppointments) ??
      readNumber(appointmentReport.totalAppointments) ??
      readNumber(appointmentSummary.totalAppointments),
    paymentCount:
      readNumber(report.paymentCount) ?? readNumber(paymentReport.paymentCount) ?? readNumber(paymentSummary.paymentCount),
    totalPaymentAmount:
      readNumber(report.totalPaymentAmount) ??
      readNumber(paymentReport.totalPaymentAmount) ??
      readNumber(paymentSummary.totalPaymentAmount),
    ownerAiOverallStatus:
      typeof aiReport.overallStatus === "string" ? aiReport.overallStatus : undefined,
  };
}

router.post(
  "/webhook",
  asyncHandler(async (req, res) => {
    await handleTelegramWebhook(req.body as TelegramUpdate, req.header("x-telegram-bot-api-secret-token") ?? undefined);

    res.json({ success: true });
  }),
);

router.post(
  "/scheduler/run",
  asyncHandler(async (req, res) => {
    const secret = req.header("x-telegram-scheduler-secret") ?? "";

    if (!env.TELEGRAM_SCHEDULER_SECRET || !isSecretMatch(secret, env.TELEGRAM_SCHEDULER_SECRET)) {
      throw new HttpError(401, "Invalid Telegram scheduler secret.");
    }

    const summary = await runTelegramSchedulerOnce();

    res.json({ success: true, data: summary });
  }),
);

router.post(
  "/scheduler/ai-revenue/run",
  asyncHandler(async (req, res) => {
    const secret = req.header("x-telegram-scheduler-secret") ?? "";

    if (!env.TELEGRAM_SCHEDULER_SECRET || !isSecretMatch(secret, env.TELEGRAM_SCHEDULER_SECRET)) {
      throw new HttpError(401, "Invalid Telegram scheduler secret.");
    }

    const summary = await runScheduledAiRevenueGeneration();

    const statusCode = scheduledAiRevenueGenerationHttpStatus(summary);
    if (statusCode !== 200) {
      res.status(statusCode).json({
        success: false,
        data: summary,
        error: `${summary.failedClinics} clinic generation run(s) failed.`,
      });
      return;
    }

    res.json({ success: true, data: summary });
  }),
);

export function scheduledAiRevenueGenerationHttpStatus(summary: { failedClinics: number }) {
  return summary.failedClinics > 0 ? 503 : 200;
}

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
      ownerAiReportTime: params.ownerAiReportTime ? normalizeReportTime(params.ownerAiReportTime) : undefined,
      weeklySummaryReportTime: params.weeklySummaryReportTime
        ? normalizeReportTime(params.weeklySummaryReportTime)
        : undefined,
      gtGrowthAiSalesAssistantTime: params.gtGrowthAiSalesAssistantTime
        ? normalizeReportTime(params.gtGrowthAiSalesAssistantTime)
        : undefined,
      gtGrowthAiOwnerProgressSummaryTime: params.gtGrowthAiOwnerProgressSummaryTime
        ? normalizeReportTime(params.gtGrowthAiOwnerProgressSummaryTime)
        : undefined,
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
    const dateKey = reportType === "appointment" || reportType === "payment" ? params.dateKey : undefined;
    const sent = await sendTrackedTelegramReport({
      clinicId: target.clinicId || params.clinicId,
      clinicCode: target.clinicCode || params.clinicCode,
      clinicName: target.clinicName || params.clinicName,
      chatId: target.telegramChatId,
      reportType,
      trigger: "manual_test",
      timezone,
      ownerAiLanguage: params.ownerAiLanguage ?? target.ownerAiLanguage,
      ownerAiTone: params.ownerAiTone ?? target.ownerAiTone,
      ownerAiFocusAreas: params.ownerAiFocusAreas ?? target.ownerAiFocusAreas,
      ownerAiCustomInstruction:
        params.ownerAiCustomInstruction === undefined
          ? target.ownerAiCustomInstruction
          : params.ownerAiCustomInstruction,
      weeklySummarySections: params.weeklySummarySections ?? target.weeklySummarySections,
      authorizationHeader: req.headers.authorization,
      dateKey,
    });

    res.json({
      success: true,
      data: buildSendResponse({
        sentAt: sent.sentAt,
        reportType,
        report: sent.report,
      }),
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
    const dateKey = reportType === "appointment" || reportType === "payment" ? params.dateKey : undefined;
    const sent = await sendTrackedTelegramReport({
      clinicId: target.clinicId || params.clinicId,
      clinicCode: target.clinicCode || params.clinicCode,
      clinicName: target.clinicName || params.clinicName,
      chatId: target.telegramChatId,
      reportType,
      trigger: "resend",
      timezone,
      ownerAiLanguage: params.ownerAiLanguage ?? target.ownerAiLanguage,
      ownerAiTone: params.ownerAiTone ?? target.ownerAiTone,
      ownerAiFocusAreas: params.ownerAiFocusAreas ?? target.ownerAiFocusAreas,
      ownerAiCustomInstruction:
        params.ownerAiCustomInstruction === undefined
          ? target.ownerAiCustomInstruction
          : params.ownerAiCustomInstruction,
      weeklySummarySections: params.weeklySummarySections ?? target.weeklySummarySections,
      authorizationHeader: req.headers.authorization,
      dateKey,
    });

    res.json({
      success: true,
      data: buildSendResponse({
        sentAt: sent.sentAt,
        reportType,
        report: sent.report,
      }),
    });
  }),
);

export default router;
