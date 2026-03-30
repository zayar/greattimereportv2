import { env } from "../../config/env.js";
import { ensureTelegramWebhook, isTelegramBotConfigured, startTelegramPolling } from "./bot.service.js";
import { sendTodayPaymentReport } from "./payment-report.service.js";
import { buildTodayAppointmentReport, sendTodayAppointmentReport } from "./report.service.js";
import {
  listTelegramIntegrationsForScheduling,
  markTelegramScheduleLockSent,
  markTelegramScheduledSent,
  releaseTelegramScheduleLock,
  tryAcquireTelegramScheduleLock,
} from "./storage.service.js";
import { formatDateKeyInTimeZone, formatTimeKeyInTimeZone } from "./time.js";
import type { TelegramIntegrationRecord, TelegramReportType } from "./types.js";

let schedulerStarted = false;
let schedulerBusy = false;

function isDueNow(reportTime: string, timezone: string, lastScheduledDateKey: string | null, now: Date) {
  const currentDateKey = formatDateKeyInTimeZone(now, timezone);
  const currentTimeKey = formatTimeKeyInTimeZone(now, timezone);

  if (lastScheduledDateKey === currentDateKey) {
    return null;
  }

  if (reportTime !== currentTimeKey) {
    return null;
  }

  return currentDateKey;
}

async function runSchedulerTick() {
  if (schedulerBusy || !env.TELEGRAM_SCHEDULER_ENABLED || !isTelegramBotConfigured()) {
    return;
  }

  schedulerBusy = true;

  try {
    const records = await listTelegramIntegrationsForScheduling();
    const now = new Date();

    for (const record of records) {
      if (!record.telegramChatId) {
        continue;
      }

      const scheduledReports: Array<{
        type: TelegramReportType;
        enabled: boolean;
        reportTime: string;
        lastScheduledDateKey: string | null;
      }> = [
        {
          type: "appointment",
          enabled: record.isTodayAppointmentReportEnabled,
          reportTime: record.reportTime,
          lastScheduledDateKey: record.lastScheduledDateKey,
        },
        {
          type: "payment",
          enabled: record.isTodayPaymentReportEnabled,
          reportTime: record.paymentReportTime,
          lastScheduledDateKey: record.lastPaymentScheduledDateKey,
        },
      ];

      for (const scheduledReport of scheduledReports) {
        if (!scheduledReport.enabled) {
          continue;
        }

        const dateKey = isDueNow(
          scheduledReport.reportTime,
          record.timezone,
          scheduledReport.lastScheduledDateKey,
          now,
        );
        if (!dateKey) {
          continue;
        }

        const lockId = await tryAcquireTelegramScheduleLock({
          clinicId: record.clinicId,
          reportType: scheduledReport.type,
          dateKey,
        });

        if (!lockId) {
          continue;
        }

        try {
          const sent = await sendScheduledReport(record, scheduledReport.type, now);

          await markTelegramScheduledSent(record.clinicId, scheduledReport.type, sent.sentAt, dateKey);
          await markTelegramScheduleLockSent(lockId, sent.sentAt);
          console.log(
            `[telegram] scheduled ${scheduledReport.type} report sent clinicId=${record.clinicId} timezone=${record.timezone}`,
          );
        } catch (error) {
          await releaseTelegramScheduleLock(lockId);
          console.error(
            `[telegram] scheduled ${scheduledReport.type} report failed clinicId=${record.clinicId} timezone=${record.timezone}`,
            error,
          );
        }
      }
    }
  } catch (error) {
    console.error("[telegram] scheduler tick failed", error);
  } finally {
    schedulerBusy = false;
  }
}

async function sendScheduledReport(record: TelegramIntegrationRecord, reportType: TelegramReportType, referenceDate: Date) {
  if (!record.telegramChatId) {
    throw new Error("Telegram chat is not linked.");
  }

  if (reportType === "payment") {
    return sendTodayPaymentReport({
      chatId: record.telegramChatId,
      clinicId: record.clinicId,
      clinicName: record.clinicName,
      timezone: record.timezone,
      referenceDate,
    });
  }

  return sendTodayAppointmentReport({
    chatId: record.telegramChatId,
    clinicCode: record.clinicCode,
    clinicName: record.clinicName,
    timezone: record.timezone,
    referenceDate,
  });
}

function startTelegramScheduler() {
  if (schedulerStarted || !env.TELEGRAM_SCHEDULER_ENABLED) {
    return;
  }

  schedulerStarted = true;
  setInterval(() => {
    void runSchedulerTick();
  }, env.TELEGRAM_SCHEDULER_INTERVAL_MS);
  void runSchedulerTick();
  console.log("[telegram] scheduler started");
}

export async function previewTodayAppointmentReportForClinic(input: {
  clinicCode: string;
  clinicName?: string;
  timezone?: string;
  authorizationHeader?: string;
}) {
  return buildTodayAppointmentReport(input);
}

export async function initializeTelegramRuntime() {
  if (!isTelegramBotConfigured()) {
    console.log("[telegram] bot token not configured, Telegram runtime skipped");
    return;
  }

  if (env.TELEGRAM_WEBHOOK_ENABLED) {
    try {
      await ensureTelegramWebhook();
    } catch (error) {
      console.error("[telegram] webhook configuration failed", error);
    }
  }

  if (env.TELEGRAM_POLLING_ENABLED) {
    startTelegramPolling();
  }

  startTelegramScheduler();
}
