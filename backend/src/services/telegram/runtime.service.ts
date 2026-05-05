import { env } from "../../config/env.js";
import { ensureTelegramWebhook, isTelegramBotConfigured, startTelegramPolling } from "./bot.service.js";
import { sendTrackedTelegramReport } from "./delivery.service.js";
import { buildTodayAppointmentReport } from "./report.service.js";
import {
  listTelegramIntegrationsForScheduling,
  markTelegramScheduleLockSent,
  releaseTelegramScheduleLock,
  tryAcquireTelegramScheduleLock,
} from "./storage.service.js";
import { formatDateKeyInTimeZone, formatTimeKeyInTimeZone } from "./time.js";
import type { TelegramReportType, TelegramTargetRecord } from "./types.js";

let schedulerStarted = false;
let schedulerBusy = false;

export type TelegramSchedulerRunSummary = {
  startedAt: string;
  finishedAt: string;
  enabledTargets: number;
  dueReports: number;
  sentReports: number;
  failedReports: number;
  lockedReports: number;
  skippedReports: number;
};

function isDueNow(reportTime: string, timezone: string, lastScheduledDateKey: string | null, now: Date) {
  const currentDateKey = formatDateKeyInTimeZone(now, timezone);
  const currentTimeKey = formatTimeKeyInTimeZone(now, timezone);

  if (lastScheduledDateKey === currentDateKey) {
    return null;
  }

  // Allow same-day catch-up if the runtime starts after the configured minute.
  if (currentTimeKey < reportTime) {
    return null;
  }

  return currentDateKey;
}

async function runSchedulerTick() {
  const summary: TelegramSchedulerRunSummary = {
    startedAt: new Date().toISOString(),
    finishedAt: "",
    enabledTargets: 0,
    dueReports: 0,
    sentReports: 0,
    failedReports: 0,
    lockedReports: 0,
    skippedReports: 0,
  };

  if (schedulerBusy || !env.TELEGRAM_SCHEDULER_ENABLED || !isTelegramBotConfigured()) {
    summary.finishedAt = new Date().toISOString();
    return summary;
  }

  schedulerBusy = true;

  try {
    const records = await listTelegramIntegrationsForScheduling();
    const now = new Date();
    summary.enabledTargets = records.length;

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
          summary.skippedReports += 1;
          continue;
        }
        summary.dueReports += 1;

        const lockId = await tryAcquireTelegramScheduleLock({
          clinicId: record.clinicId,
          chatId: record.telegramChatId,
          reportType: scheduledReport.type,
          dateKey,
        });

        if (!lockId) {
          summary.lockedReports += 1;
          continue;
        }

        try {
          const sent = await sendScheduledReport(record, scheduledReport.type, now);

          await markTelegramScheduleLockSent(lockId, sent.sentAt);
          summary.sentReports += 1;
          console.log(
            `[telegram] scheduled ${scheduledReport.type} report sent clinicId=${record.clinicId} chatId=${record.telegramChatId} timezone=${record.timezone}`,
          );
        } catch (error) {
          await releaseTelegramScheduleLock(lockId);
          summary.failedReports += 1;
          console.error(
            `[telegram] scheduled ${scheduledReport.type} report failed clinicId=${record.clinicId} chatId=${record.telegramChatId} timezone=${record.timezone}`,
            error,
          );
        }
      }
    }
  } catch (error) {
    console.error("[telegram] scheduler tick failed", error);
  } finally {
    schedulerBusy = false;
    summary.finishedAt = new Date().toISOString();
  }

  return summary;
}

export async function runTelegramSchedulerOnce() {
  return runSchedulerTick();
}

async function sendScheduledReport(record: TelegramTargetRecord, reportType: TelegramReportType, referenceDate: Date) {
  if (!record.telegramChatId) {
    throw new Error("Telegram chat is not linked.");
  }

  return sendTrackedTelegramReport({
    clinicId: record.clinicId,
    clinicCode: record.clinicCode,
    clinicName: record.clinicName,
    chatId: record.telegramChatId,
    reportType,
    trigger: "scheduled",
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
