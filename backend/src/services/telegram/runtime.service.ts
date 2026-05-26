import { env } from "../../config/env.js";
import {
  ensureTelegramWebhook,
  getExpectedTelegramWebhookUrl,
  getTelegramWebhookInfo,
  isTelegramBotConfigured,
  startTelegramPolling,
} from "./bot.service.js";
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
let schedulerBusyUntilMs = 0;
let webhookWatchdogStarted = false;

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

  if (!env.TELEGRAM_SCHEDULER_ENABLED || !isTelegramBotConfigured()) {
    summary.finishedAt = new Date().toISOString();
    return summary;
  }

  if (schedulerBusy) {
    if (Date.now() < schedulerBusyUntilMs) {
      summary.finishedAt = new Date().toISOString();
      return summary;
    }

    console.warn("[telegram] scheduler busy guard expired; allowing a new tick");
    schedulerBusy = false;
  }

  schedulerBusy = true;
  schedulerBusyUntilMs = Date.now() + env.TELEGRAM_SCHEDULER_BUSY_TIMEOUT_MS;

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
    schedulerBusyUntilMs = 0;
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
  const timer = setInterval(() => {
    void runSchedulerTick();
  }, env.TELEGRAM_SCHEDULER_INTERVAL_MS);
  timer.unref?.();
  void runSchedulerTick();
  console.log("[telegram] scheduler started");
}

function normalizeWebhookUrl(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\/+$/, "");
}

async function checkTelegramWebhookOnce() {
  if (!env.TELEGRAM_WEBHOOK_ENABLED || !env.TELEGRAM_WEBHOOK_WATCHDOG_ENABLED || !isTelegramBotConfigured()) {
    return;
  }

  const expectedUrl = normalizeWebhookUrl(getExpectedTelegramWebhookUrl());
  if (!expectedUrl) {
    return;
  }

  try {
    const info = await getTelegramWebhookInfo();
    const actualUrl = normalizeWebhookUrl(info.url);

    if (actualUrl === expectedUrl) {
      return;
    }

    console.warn("[telegram] webhook mismatch detected; reconfiguring webhook", {
      expectedUrl,
      actualUrl,
      pendingUpdateCount: info.pending_update_count ?? 0,
      lastErrorDate: info.last_error_date ?? null,
      lastErrorMessage: info.last_error_message ?? "",
    });

    await ensureTelegramWebhook();
  } catch (error) {
    console.warn("[telegram] webhook watchdog failed", error);
  }
}

function startTelegramWebhookWatchdog() {
  if (webhookWatchdogStarted || !env.TELEGRAM_WEBHOOK_ENABLED || !env.TELEGRAM_WEBHOOK_WATCHDOG_ENABLED) {
    return;
  }

  const expectedUrl = getExpectedTelegramWebhookUrl();
  if (!expectedUrl) {
    console.log("[telegram] webhook watchdog skipped because APP_BASE_URL is not configured");
    return;
  }

  webhookWatchdogStarted = true;
  void checkTelegramWebhookOnce();
  const timer = setInterval(() => {
    void checkTelegramWebhookOnce();
  }, env.TELEGRAM_WEBHOOK_WATCHDOG_INTERVAL_MS);
  timer.unref?.();
  console.log("[telegram] webhook watchdog started");
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

  startTelegramWebhookWatchdog();
  startTelegramScheduler();
}
