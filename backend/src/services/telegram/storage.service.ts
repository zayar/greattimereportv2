import { randomBytes } from "node:crypto";
import { firestoreDb } from "../../config/firebase.js";
import { env } from "../../config/env.js";
import { HttpError } from "../../utils/http-error.js";
import { normalizeReportTime, normalizeTimeZone } from "./time.js";
import type {
  TelegramChatTarget,
  TelegramConnectionStatus,
  TelegramIntegrationRecord,
  TelegramReportType,
  TelegramIntegrationStatus,
  TelegramLinkCodeRecord,
} from "./types.js";

const SETTINGS_COLLECTION = "gt_v2report_telegram_settings";
const LINK_CODES_COLLECTION = "gt_v2report_telegram_link_codes";
const SCHEDULE_LOCKS_COLLECTION = "gt_v2report_telegram_schedule_locks";
const CHAT_LINKS_COLLECTION = "gt_v2report_telegram_chat_links";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function settingsRef(clinicId: string) {
  return firestoreDb().collection(SETTINGS_COLLECTION).doc(clinicId);
}

function linkCodeRef(code: string) {
  return firestoreDb().collection(LINK_CODES_COLLECTION).doc(code);
}

function scheduleLockRef(lockId: string) {
  return firestoreDb().collection(SCHEDULE_LOCKS_COLLECTION).doc(lockId);
}

function chatLinkRef(chatId: string) {
  return firestoreDb().collection(CHAT_LINKS_COLLECTION).doc(chatId);
}

function nowIso() {
  return new Date().toISOString();
}

function isFutureIso(value: string | null | undefined) {
  return Boolean(value && new Date(value).getTime() > Date.now());
}

function buildDefaultRecord(input: { clinicId: string; clinicCode?: string; clinicName?: string }): TelegramIntegrationRecord {
  return {
    clinicId: input.clinicId,
    clinicCode: input.clinicCode ?? "",
    clinicName: input.clinicName ?? "",
    telegramChatId: null,
    telegramChatType: null,
    telegramChatTitle: null,
    telegramLinkedAt: null,
    isTodayAppointmentReportEnabled: false,
    reportTime: env.TELEGRAM_REPORT_DEFAULT_TIME,
    isTodayPaymentReportEnabled: false,
    paymentReportTime: env.TELEGRAM_REPORT_DEFAULT_TIME,
    timezone: env.DEFAULT_TIMEZONE,
    lastTestSentAt: null,
    lastScheduledSentAt: null,
    lastScheduledDateKey: null,
    lastPaymentTestSentAt: null,
    lastPaymentScheduledSentAt: null,
    lastPaymentScheduledDateKey: null,
    pendingLinkCode: null,
    pendingLinkCodeExpiresAt: null,
    createdAt: null,
    updatedAt: null,
  };
}

function normalizeRecord(
  clinicId: string,
  data: Record<string, unknown> | undefined,
  fallback?: { clinicCode?: string; clinicName?: string },
): TelegramIntegrationRecord {
  const defaults = buildDefaultRecord({
    clinicId,
    clinicCode: fallback?.clinicCode,
    clinicName: fallback?.clinicName,
  });

  if (!data) {
    return defaults;
  }

  return {
    clinicId,
    clinicCode: typeof data.clinicCode === "string" && data.clinicCode.trim() ? data.clinicCode : defaults.clinicCode,
    clinicName: typeof data.clinicName === "string" && data.clinicName.trim() ? data.clinicName : defaults.clinicName,
    telegramChatId: typeof data.telegramChatId === "string" ? data.telegramChatId : null,
    telegramChatType:
      data.telegramChatType === "private" ||
      data.telegramChatType === "group" ||
      data.telegramChatType === "supergroup" ||
      data.telegramChatType === "channel"
        ? data.telegramChatType
        : null,
    telegramChatTitle: typeof data.telegramChatTitle === "string" ? data.telegramChatTitle : null,
    telegramLinkedAt: typeof data.telegramLinkedAt === "string" ? data.telegramLinkedAt : null,
    isTodayAppointmentReportEnabled:
      typeof data.isTodayAppointmentReportEnabled === "boolean"
        ? data.isTodayAppointmentReportEnabled
        : defaults.isTodayAppointmentReportEnabled,
    reportTime: normalizeReportTime(typeof data.reportTime === "string" ? data.reportTime : defaults.reportTime),
    isTodayPaymentReportEnabled:
      typeof data.isTodayPaymentReportEnabled === "boolean"
        ? data.isTodayPaymentReportEnabled
        : defaults.isTodayPaymentReportEnabled,
    paymentReportTime: normalizeReportTime(
      typeof data.paymentReportTime === "string" ? data.paymentReportTime : defaults.paymentReportTime,
    ),
    timezone: normalizeTimeZone(typeof data.timezone === "string" ? data.timezone : defaults.timezone),
    lastTestSentAt: typeof data.lastTestSentAt === "string" ? data.lastTestSentAt : null,
    lastScheduledSentAt: typeof data.lastScheduledSentAt === "string" ? data.lastScheduledSentAt : null,
    lastScheduledDateKey: typeof data.lastScheduledDateKey === "string" ? data.lastScheduledDateKey : null,
    lastPaymentTestSentAt: typeof data.lastPaymentTestSentAt === "string" ? data.lastPaymentTestSentAt : null,
    lastPaymentScheduledSentAt:
      typeof data.lastPaymentScheduledSentAt === "string" ? data.lastPaymentScheduledSentAt : null,
    lastPaymentScheduledDateKey:
      typeof data.lastPaymentScheduledDateKey === "string" ? data.lastPaymentScheduledDateKey : null,
    pendingLinkCode: typeof data.pendingLinkCode === "string" ? data.pendingLinkCode : null,
    pendingLinkCodeExpiresAt: typeof data.pendingLinkCodeExpiresAt === "string" ? data.pendingLinkCodeExpiresAt : null,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : null,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
  };
}

function getConnectionStatus(record: TelegramIntegrationRecord): TelegramConnectionStatus {
  if (record.telegramChatId) {
    return "linked";
  }

  if (record.pendingLinkCode && isFutureIso(record.pendingLinkCodeExpiresAt)) {
    return "pending";
  }

  return "not_linked";
}

function getLinkedTargetLabel(record: TelegramIntegrationRecord) {
  if (!record.telegramChatId) {
    return null;
  }

  if (record.telegramChatTitle?.trim()) {
    return record.telegramChatTitle;
  }

  return record.telegramChatType === "private" ? "Telegram private chat" : `Telegram ${record.telegramChatType ?? "chat"}`;
}

function buildStatus(record: TelegramIntegrationRecord): TelegramIntegrationStatus {
  return {
    ...record,
    connectionStatus: getConnectionStatus(record),
    linkedTargetLabel: getLinkedTargetLabel(record),
    botUsername: null,
    botUrl: null,
    botDeepLink: null,
  };
}

function generateLinkCodeValue() {
  const bytes = randomBytes(6);
  let code = "";
  for (let index = 0; index < 8; index += 1) {
    code += CODE_ALPHABET[bytes[index % bytes.length] % CODE_ALPHABET.length];
  }
  return code;
}

async function clearExpiredPendingCode(clinicId: string, record: TelegramIntegrationRecord) {
  if (!record.pendingLinkCode || isFutureIso(record.pendingLinkCodeExpiresAt)) {
    return record;
  }

  await settingsRef(clinicId).set(
    {
      pendingLinkCode: null,
      pendingLinkCodeExpiresAt: null,
      updatedAt: nowIso(),
    },
    { merge: true },
  );

  return {
    ...record,
    pendingLinkCode: null,
    pendingLinkCodeExpiresAt: null,
    updatedAt: nowIso(),
  };
}

export async function getTelegramIntegrationStatus(input: {
  clinicId: string;
  clinicCode?: string;
  clinicName?: string;
}) {
  const snapshot = await settingsRef(input.clinicId).get();
  const record = normalizeRecord(input.clinicId, snapshot.data(), {
    clinicCode: input.clinicCode,
    clinicName: input.clinicName,
  });
  const cleanedRecord = await clearExpiredPendingCode(input.clinicId, record);

  return buildStatus(cleanedRecord);
}

export async function updateTelegramReportSettings(input: {
  clinicId: string;
  clinicCode?: string;
  clinicName?: string;
  isTodayAppointmentReportEnabled: boolean;
  reportTime: string;
  isTodayPaymentReportEnabled: boolean;
  paymentReportTime: string;
  timezone: string;
}) {
  const existing = await getTelegramIntegrationStatus({
    clinicId: input.clinicId,
    clinicCode: input.clinicCode,
    clinicName: input.clinicName,
  });
  const timestamp = nowIso();

  const nextRecord: TelegramIntegrationRecord = {
    ...existing,
    clinicCode: input.clinicCode ?? existing.clinicCode,
    clinicName: input.clinicName ?? existing.clinicName,
    isTodayAppointmentReportEnabled: Boolean(input.isTodayAppointmentReportEnabled) && Boolean(existing.telegramChatId),
    reportTime: normalizeReportTime(input.reportTime),
    isTodayPaymentReportEnabled: Boolean(input.isTodayPaymentReportEnabled) && Boolean(existing.telegramChatId),
    paymentReportTime: normalizeReportTime(input.paymentReportTime),
    timezone: normalizeTimeZone(input.timezone),
    updatedAt: timestamp,
    createdAt: existing.createdAt ?? timestamp,
  };

  await settingsRef(input.clinicId).set(nextRecord, { merge: true });

  return buildStatus(nextRecord);
}

export async function generateTelegramLinkCode(input: {
  clinicId: string;
  clinicCode: string;
  clinicName: string;
  createdByUserId?: string;
  createdByEmail?: string;
}) {
  const expiresAt = new Date(Date.now() + env.TELEGRAM_LINK_CODE_TTL_MINUTES * 60_000).toISOString();
  const createdAt = nowIso();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateLinkCodeValue();
    const linkRecord: TelegramLinkCodeRecord = {
      code,
      clinicId: input.clinicId,
      clinicCode: input.clinicCode,
      clinicName: input.clinicName,
      createdAt,
      expiresAt,
      createdByUserId: input.createdByUserId ?? null,
      createdByEmail: input.createdByEmail ?? null,
      redeemedAt: null,
      telegramChatId: null,
      telegramChatType: null,
      telegramChatTitle: null,
    };

    try {
      await firestoreDb().runTransaction(async (transaction) => {
        const existingLink = await transaction.get(linkCodeRef(code));
        if (existingLink.exists) {
          throw new Error("duplicate-link-code");
        }

        const currentSettingsSnapshot = await transaction.get(settingsRef(input.clinicId));
        const currentSettings = normalizeRecord(input.clinicId, currentSettingsSnapshot.data(), {
          clinicCode: input.clinicCode,
          clinicName: input.clinicName,
        });

        transaction.create(linkCodeRef(code), linkRecord);
        transaction.set(
          settingsRef(input.clinicId),
          {
            ...currentSettings,
            clinicCode: input.clinicCode,
            clinicName: input.clinicName,
            pendingLinkCode: code,
            pendingLinkCodeExpiresAt: expiresAt,
            updatedAt: createdAt,
            createdAt: currentSettings.createdAt ?? createdAt,
          },
          { merge: true },
        );
      });

      return getTelegramIntegrationStatus({
        clinicId: input.clinicId,
        clinicCode: input.clinicCode,
        clinicName: input.clinicName,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "duplicate-link-code") {
        continue;
      }

      throw error;
    }
  }

  throw new HttpError(500, "Could not generate a unique Telegram link code. Please try again.");
}

export async function redeemTelegramLinkCode(input: {
  code: string;
  chat: TelegramChatTarget;
}) {
  const codeValue = input.code.trim().toUpperCase();

  return firestoreDb().runTransaction(async (transaction) => {
    const codeSnapshot = await transaction.get(linkCodeRef(codeValue));
    if (!codeSnapshot.exists) {
      throw new HttpError(404, "Telegram link code not found or already expired.");
    }

    const linkRecord = codeSnapshot.data() as TelegramLinkCodeRecord | undefined;
    if (!linkRecord) {
      throw new HttpError(404, "Telegram link code is invalid.");
    }

    if (linkRecord.redeemedAt) {
      throw new HttpError(409, "Telegram link code has already been used.");
    }

    if (new Date(linkRecord.expiresAt).getTime() <= Date.now()) {
      throw new HttpError(410, "Telegram link code has expired.");
    }

    const settingsSnapshot = await transaction.get(settingsRef(linkRecord.clinicId));
    const currentSettings = normalizeRecord(linkRecord.clinicId, settingsSnapshot.data(), {
      clinicCode: linkRecord.clinicCode,
      clinicName: linkRecord.clinicName,
    });
    const existingChatLinkSnapshot = await transaction.get(chatLinkRef(input.chat.id));
    const existingChatLink = existingChatLinkSnapshot.data() as
      | {
          clinicId?: string;
          clinicCode?: string;
          clinicName?: string;
        }
      | undefined;

    if (existingChatLink?.clinicId && existingChatLink.clinicId !== linkRecord.clinicId) {
      throw new HttpError(
        409,
        `This Telegram chat is already linked to ${existingChatLink.clinicName || existingChatLink.clinicCode || "another clinic"}. Unlink it there first to avoid mixing clinic data.`,
      );
    }

    if (currentSettings.telegramChatId && currentSettings.telegramChatId !== input.chat.id) {
      transaction.delete(chatLinkRef(currentSettings.telegramChatId));
    }
    const timestamp = nowIso();

    const nextRecord: TelegramIntegrationRecord = {
      ...currentSettings,
      clinicCode: linkRecord.clinicCode,
      clinicName: linkRecord.clinicName,
      telegramChatId: input.chat.id,
      telegramChatType: input.chat.type,
      telegramChatTitle: input.chat.title,
      telegramLinkedAt: timestamp,
      pendingLinkCode: null,
      pendingLinkCodeExpiresAt: null,
      updatedAt: timestamp,
      createdAt: currentSettings.createdAt ?? timestamp,
    };

    transaction.set(settingsRef(linkRecord.clinicId), nextRecord, { merge: true });
    transaction.set(chatLinkRef(input.chat.id), {
      clinicId: linkRecord.clinicId,
      clinicCode: linkRecord.clinicCode,
      clinicName: linkRecord.clinicName,
      telegramChatId: input.chat.id,
      telegramChatType: input.chat.type,
      telegramChatTitle: input.chat.title,
      linkedAt: timestamp,
    });
    transaction.set(
      linkCodeRef(codeValue),
      {
        redeemedAt: timestamp,
        telegramChatId: input.chat.id,
        telegramChatType: input.chat.type,
        telegramChatTitle: input.chat.title,
      },
      { merge: true },
    );

    return buildStatus(nextRecord);
  });
}

export async function unlinkTelegramIntegration(input: {
  clinicId: string;
}) {
  const existing = await getTelegramIntegrationStatus({ clinicId: input.clinicId });
  const timestamp = nowIso();

  const nextRecord: TelegramIntegrationRecord = {
    ...existing,
    telegramChatId: null,
    telegramChatType: null,
    telegramChatTitle: null,
    telegramLinkedAt: null,
    isTodayAppointmentReportEnabled: false,
    isTodayPaymentReportEnabled: false,
    pendingLinkCode: null,
    pendingLinkCodeExpiresAt: null,
    updatedAt: timestamp,
    createdAt: existing.createdAt ?? timestamp,
  };

  await firestoreDb().runTransaction(async (transaction) => {
    let shouldDeleteChatLink = false;

    if (existing.telegramChatId) {
      const existingChatLinkSnapshot = await transaction.get(chatLinkRef(existing.telegramChatId));
      const existingChatLink = existingChatLinkSnapshot.data() as { clinicId?: string } | undefined;
      shouldDeleteChatLink = existingChatLink?.clinicId === input.clinicId;
    }

    transaction.set(settingsRef(input.clinicId), nextRecord, { merge: true });

    if (existing.telegramChatId && shouldDeleteChatLink) {
      transaction.delete(chatLinkRef(existing.telegramChatId));
    }
  });

  return buildStatus(nextRecord);
}

export async function markTelegramTestSent(clinicId: string, reportType: TelegramReportType, sentAt: string) {
  await settingsRef(clinicId).set(
    reportType === "appointment"
      ? {
          lastTestSentAt: sentAt,
          updatedAt: sentAt,
        }
      : {
          lastPaymentTestSentAt: sentAt,
          updatedAt: sentAt,
        },
    { merge: true },
  );
}

export async function markTelegramScheduledSent(
  clinicId: string,
  reportType: TelegramReportType,
  sentAt: string,
  dateKey: string,
) {
  await settingsRef(clinicId).set(
    reportType === "appointment"
      ? {
          lastScheduledSentAt: sentAt,
          lastScheduledDateKey: dateKey,
          updatedAt: sentAt,
        }
      : {
          lastPaymentScheduledSentAt: sentAt,
          lastPaymentScheduledDateKey: dateKey,
          updatedAt: sentAt,
        },
    { merge: true },
  );
}

export async function listTelegramIntegrationsForScheduling() {
  const snapshot = await firestoreDb().collection(SETTINGS_COLLECTION).get();

  return snapshot.docs
    .map((doc) => normalizeRecord(doc.id, doc.data()))
    .filter(
      (record) =>
        Boolean(record.telegramChatId) &&
        (record.isTodayAppointmentReportEnabled || record.isTodayPaymentReportEnabled),
    );
}

export async function tryAcquireTelegramScheduleLock(input: {
  clinicId: string;
  reportType: TelegramReportType;
  dateKey: string;
}) {
  const lockId = `${input.clinicId}_${input.reportType}_${input.dateKey}`;
  const lockDoc = scheduleLockRef(lockId);
  const acquiredAt = nowIso();
  const expiresAt = new Date(Date.now() + 20 * 60_000).toISOString();

  const acquired = await firestoreDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(lockDoc);
    if (snapshot.exists) {
      const data = snapshot.data() as { expiresAt?: string } | undefined;
      if (data?.expiresAt && new Date(data.expiresAt).getTime() > Date.now()) {
        return false;
      }
    }

    transaction.set(lockDoc, {
      clinicId: input.clinicId,
      reportType: input.reportType,
      dateKey: input.dateKey,
      acquiredAt,
      expiresAt,
      status: "acquired",
    });
    return true;
  });

  return acquired ? lockId : null;
}

export async function markTelegramScheduleLockSent(lockId: string, sentAt: string) {
  await scheduleLockRef(lockId).set(
    {
      sentAt,
      status: "sent",
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
    },
    { merge: true },
  );
}

export async function releaseTelegramScheduleLock(lockId: string) {
  await scheduleLockRef(lockId).delete();
}
