import { randomBytes } from "node:crypto";
import { firestoreDb } from "../../config/firebase.js";
import { env } from "../../config/env.js";
import { HttpError } from "../../utils/http-error.js";
import { normalizeReportTime, normalizeTimeZone } from "./time.js";
import type {
  TelegramChatTarget,
  TelegramConnectionStatus,
  TelegramDeliveryLogEntry,
  TelegramDeliveryLogRecord,
  TelegramDeliveryTrigger,
  TelegramIntegrationRecord,
  TelegramIntegrationStatus,
  TelegramLinkCodeRecord,
  TelegramReportSettingsRecord,
  TelegramReportType,
  TelegramTargetRecord,
  TelegramTargetStatus,
} from "./types.js";

const SETTINGS_COLLECTION = "gt_v2report_telegram_settings";
const LINK_CODES_COLLECTION = "gt_v2report_telegram_link_codes";
const SCHEDULE_LOCKS_COLLECTION = "gt_v2report_telegram_schedule_locks";
const CHAT_LINKS_COLLECTION = "gt_v2report_telegram_chat_links";
const TARGETS_COLLECTION = "gt_v2report_telegram_targets";
const DELIVERY_LOGS_COLLECTION = "gt_v2report_telegram_delivery_logs";
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

function targetDocId(clinicId: string, chatId: string) {
  return `${encodeURIComponent(clinicId)}__${encodeURIComponent(chatId)}`;
}

function targetRef(clinicId: string, chatId: string) {
  return firestoreDb().collection(TARGETS_COLLECTION).doc(targetDocId(clinicId, chatId));
}

function deliveryLogsCollection() {
  return firestoreDb().collection(DELIVERY_LOGS_COLLECTION);
}

function nowIso() {
  return new Date().toISOString();
}

function isFutureIso(value: string | null | undefined) {
  return Boolean(value && new Date(value).getTime() > Date.now());
}

function parseReportSettings(
  data: Record<string, unknown> | undefined,
  defaults: TelegramReportSettingsRecord,
): TelegramReportSettingsRecord {
  return {
    telegramChatId: typeof data?.telegramChatId === "string" ? data.telegramChatId : defaults.telegramChatId,
    telegramChatType:
      data?.telegramChatType === "private" ||
      data?.telegramChatType === "group" ||
      data?.telegramChatType === "supergroup" ||
      data?.telegramChatType === "channel"
        ? data.telegramChatType
        : defaults.telegramChatType,
    telegramChatTitle: typeof data?.telegramChatTitle === "string" ? data.telegramChatTitle : defaults.telegramChatTitle,
    telegramLinkedAt: typeof data?.telegramLinkedAt === "string" ? data.telegramLinkedAt : defaults.telegramLinkedAt,
    isTodayAppointmentReportEnabled:
      typeof data?.isTodayAppointmentReportEnabled === "boolean"
        ? data.isTodayAppointmentReportEnabled
        : defaults.isTodayAppointmentReportEnabled,
    reportTime: normalizeReportTime(typeof data?.reportTime === "string" ? data.reportTime : defaults.reportTime),
    isTodayPaymentReportEnabled:
      typeof data?.isTodayPaymentReportEnabled === "boolean"
        ? data.isTodayPaymentReportEnabled
        : defaults.isTodayPaymentReportEnabled,
    paymentReportTime: normalizeReportTime(
      typeof data?.paymentReportTime === "string" ? data.paymentReportTime : defaults.paymentReportTime,
    ),
    timezone: normalizeTimeZone(typeof data?.timezone === "string" ? data.timezone : defaults.timezone),
    lastTestSentAt: typeof data?.lastTestSentAt === "string" ? data.lastTestSentAt : defaults.lastTestSentAt,
    lastScheduledSentAt:
      typeof data?.lastScheduledSentAt === "string" ? data.lastScheduledSentAt : defaults.lastScheduledSentAt,
    lastScheduledDateKey:
      typeof data?.lastScheduledDateKey === "string" ? data.lastScheduledDateKey : defaults.lastScheduledDateKey,
    lastPaymentTestSentAt:
      typeof data?.lastPaymentTestSentAt === "string" ? data.lastPaymentTestSentAt : defaults.lastPaymentTestSentAt,
    lastPaymentScheduledSentAt:
      typeof data?.lastPaymentScheduledSentAt === "string"
        ? data.lastPaymentScheduledSentAt
        : defaults.lastPaymentScheduledSentAt,
    lastPaymentScheduledDateKey:
      typeof data?.lastPaymentScheduledDateKey === "string"
        ? data.lastPaymentScheduledDateKey
        : defaults.lastPaymentScheduledDateKey,
    lastAppointmentFailureAt:
      typeof data?.lastAppointmentFailureAt === "string"
        ? data.lastAppointmentFailureAt
        : defaults.lastAppointmentFailureAt,
    lastAppointmentFailureReason:
      typeof data?.lastAppointmentFailureReason === "string"
        ? data.lastAppointmentFailureReason
        : defaults.lastAppointmentFailureReason,
    lastPaymentFailureAt:
      typeof data?.lastPaymentFailureAt === "string"
        ? data.lastPaymentFailureAt
        : defaults.lastPaymentFailureAt,
    lastPaymentFailureReason:
      typeof data?.lastPaymentFailureReason === "string"
        ? data.lastPaymentFailureReason
        : defaults.lastPaymentFailureReason,
  };
}

function buildDefaultReportSettings(input?: {
  telegramChatId?: string | null;
  telegramChatType?: TelegramChatTarget["type"] | null;
  telegramChatTitle?: string | null;
  telegramLinkedAt?: string | null;
}): TelegramReportSettingsRecord {
  return {
    telegramChatId: input?.telegramChatId ?? null,
    telegramChatType: input?.telegramChatType ?? null,
    telegramChatTitle: input?.telegramChatTitle ?? null,
    telegramLinkedAt: input?.telegramLinkedAt ?? null,
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
    lastAppointmentFailureAt: null,
    lastAppointmentFailureReason: null,
    lastPaymentFailureAt: null,
    lastPaymentFailureReason: null,
  };
}

function buildDefaultRecord(input: { clinicId: string; clinicCode?: string; clinicName?: string }): TelegramIntegrationRecord {
  return {
    clinicId: input.clinicId,
    clinicCode: input.clinicCode ?? "",
    clinicName: input.clinicName ?? "",
    ...buildDefaultReportSettings(),
    pendingLinkCode: null,
    pendingLinkCodeExpiresAt: null,
    createdAt: null,
    updatedAt: null,
  };
}

function buildDefaultTargetRecord(input: {
  clinicId: string;
  clinicCode?: string;
  clinicName?: string;
  telegramChatId: string;
  telegramChatType: TelegramChatTarget["type"];
  telegramChatTitle: string | null;
  telegramLinkedAt?: string | null;
}): TelegramTargetRecord {
  return {
    clinicId: input.clinicId,
    clinicCode: input.clinicCode ?? "",
    clinicName: input.clinicName ?? "",
    ...buildDefaultReportSettings({
      telegramChatId: input.telegramChatId,
      telegramChatType: input.telegramChatType,
      telegramChatTitle: input.telegramChatTitle,
      telegramLinkedAt: input.telegramLinkedAt ?? null,
    }),
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
    ...parseReportSettings(data, defaults),
    pendingLinkCode: typeof data.pendingLinkCode === "string" ? data.pendingLinkCode : null,
    pendingLinkCodeExpiresAt: typeof data.pendingLinkCodeExpiresAt === "string" ? data.pendingLinkCodeExpiresAt : null,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : null,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
  };
}

function normalizeTargetRecord(
  clinicId: string,
  data: Record<string, unknown> | undefined,
  fallback: {
    clinicCode?: string;
    clinicName?: string;
    telegramChatId: string;
    telegramChatType?: TelegramChatTarget["type"] | null;
    telegramChatTitle?: string | null;
  },
): TelegramTargetRecord {
  const defaults = buildDefaultTargetRecord({
    clinicId,
    clinicCode: fallback.clinicCode,
    clinicName: fallback.clinicName,
    telegramChatId: fallback.telegramChatId,
    telegramChatType: fallback.telegramChatType ?? "private",
    telegramChatTitle: fallback.telegramChatTitle ?? null,
  });

  if (!data) {
    return defaults;
  }

  return {
    clinicId,
    clinicCode: typeof data.clinicCode === "string" && data.clinicCode.trim() ? data.clinicCode : defaults.clinicCode,
    clinicName: typeof data.clinicName === "string" && data.clinicName.trim() ? data.clinicName : defaults.clinicName,
    ...parseReportSettings(data, defaults),
    createdAt: typeof data.createdAt === "string" ? data.createdAt : null,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
  };
}

function getTargetLabel(target: TelegramTargetRecord) {
  if (target.telegramChatTitle?.trim()) {
    return target.telegramChatTitle.trim();
  }

  return target.telegramChatType === "private" ? "Telegram private chat" : `Telegram ${target.telegramChatType ?? "chat"}`;
}

function buildDeliveryLogEntry(id: string, data: Record<string, unknown> | undefined): TelegramDeliveryLogEntry | null {
  const clinicId = typeof data?.clinicId === "string" ? data.clinicId : null;
  const telegramChatId = typeof data?.telegramChatId === "string" ? data.telegramChatId : null;
  const reportType = data?.reportType === "appointment" || data?.reportType === "payment" ? data.reportType : null;
  const trigger =
    data?.trigger === "manual_test" || data?.trigger === "scheduled" || data?.trigger === "resend" ? data.trigger : null;
  const outcome = data?.outcome === "sent" || data?.outcome === "failed" ? data.outcome : null;

  if (!clinicId || !telegramChatId || !reportType || !trigger || !outcome) {
    return null;
  }

  return {
    id,
    clinicId,
    clinicCode: typeof data?.clinicCode === "string" ? data.clinicCode : "",
    clinicName: typeof data?.clinicName === "string" ? data.clinicName : "",
    telegramChatId,
    reportType,
    trigger,
    outcome,
    attemptedAt: typeof data?.attemptedAt === "string" ? data.attemptedAt : nowIso(),
    dateKey: typeof data?.dateKey === "string" ? data.dateKey : null,
    timezone: normalizeTimeZone(typeof data?.timezone === "string" ? data.timezone : env.DEFAULT_TIMEZONE),
    appointmentCount: typeof data?.appointmentCount === "number" ? data.appointmentCount : null,
    paymentCount: typeof data?.paymentCount === "number" ? data.paymentCount : null,
    totalPaymentAmount: typeof data?.totalPaymentAmount === "number" ? data.totalPaymentAmount : null,
    errorMessage: typeof data?.errorMessage === "string" ? data.errorMessage : null,
  };
}

function buildTargetStatus(target: TelegramTargetRecord, deliveryHistory: TelegramDeliveryLogEntry[]): TelegramTargetStatus {
  return {
    ...target,
    targetLabel: getTargetLabel(target),
    deliveryHistory,
  };
}

function sortTargets(targets: TelegramTargetRecord[]) {
  return [...targets].sort((left, right) => {
    const leftTime = new Date(left.telegramLinkedAt ?? left.updatedAt ?? left.createdAt ?? 0).getTime();
    const rightTime = new Date(right.telegramLinkedAt ?? right.updatedAt ?? right.createdAt ?? 0).getTime();
    return rightTime - leftTime;
  });
}

function getConnectionStatus(record: TelegramIntegrationRecord, targets: TelegramTargetRecord[]): TelegramConnectionStatus {
  if (targets.length > 0) {
    return "linked";
  }

  if (record.pendingLinkCode && isFutureIso(record.pendingLinkCodeExpiresAt)) {
    return "pending";
  }

  return "not_linked";
}

function getLinkedTargetLabel(targets: TelegramTargetRecord[]) {
  if (targets.length === 0) {
    return null;
  }

  if (targets.length === 1) {
    return getTargetLabel(targets[0]);
  }

  return `${targets.length} Telegram targets linked`;
}

async function loadDeliveryLogsForClinic(clinicId: string) {
  const snapshot = await deliveryLogsCollection().where("clinicId", "==", clinicId).get();

  return snapshot.docs
    .map((doc) => buildDeliveryLogEntry(doc.id, doc.data()))
    .filter((entry): entry is TelegramDeliveryLogEntry => Boolean(entry))
    .sort(
      (left, right) =>
        new Date(right.attemptedAt).getTime() - new Date(left.attemptedAt).getTime(),
    );
}

function buildStatus(
  record: TelegramIntegrationRecord,
  targets: TelegramTargetRecord[],
  deliveries: TelegramDeliveryLogEntry[],
): TelegramIntegrationStatus {
  const sortedTargets = sortTargets(targets);
  const deliveriesByChatId = new Map<string, TelegramDeliveryLogEntry[]>();
  deliveries.forEach((entry) => {
    const current = deliveriesByChatId.get(entry.telegramChatId) ?? [];
    if (current.length < 8) {
      current.push(entry);
    }
    deliveriesByChatId.set(entry.telegramChatId, current);
  });
  const primaryTarget = sortedTargets[0] ?? null;
  const primaryReportSettings = primaryTarget
    ? {
        telegramChatId: primaryTarget.telegramChatId,
        telegramChatType: primaryTarget.telegramChatType,
        telegramChatTitle: primaryTarget.telegramChatTitle,
        telegramLinkedAt: primaryTarget.telegramLinkedAt,
        isTodayAppointmentReportEnabled: primaryTarget.isTodayAppointmentReportEnabled,
        reportTime: primaryTarget.reportTime,
        isTodayPaymentReportEnabled: primaryTarget.isTodayPaymentReportEnabled,
        paymentReportTime: primaryTarget.paymentReportTime,
        timezone: primaryTarget.timezone,
        lastTestSentAt: primaryTarget.lastTestSentAt,
        lastScheduledSentAt: primaryTarget.lastScheduledSentAt,
        lastScheduledDateKey: primaryTarget.lastScheduledDateKey,
        lastPaymentTestSentAt: primaryTarget.lastPaymentTestSentAt,
        lastPaymentScheduledSentAt: primaryTarget.lastPaymentScheduledSentAt,
        lastPaymentScheduledDateKey: primaryTarget.lastPaymentScheduledDateKey,
        lastAppointmentFailureAt: primaryTarget.lastAppointmentFailureAt,
        lastAppointmentFailureReason: primaryTarget.lastAppointmentFailureReason,
        lastPaymentFailureAt: primaryTarget.lastPaymentFailureAt,
        lastPaymentFailureReason: primaryTarget.lastPaymentFailureReason,
      }
    : buildDefaultReportSettings();

  return {
    ...record,
    ...primaryReportSettings,
    connectionStatus: getConnectionStatus(record, sortedTargets),
    linkedTargetLabel: getLinkedTargetLabel(sortedTargets),
    linkedTargetCount: sortedTargets.length,
    linkedTargets: sortedTargets.map((target) => buildTargetStatus(target, deliveriesByChatId.get(target.telegramChatId ?? "") ?? [])),
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

  const updatedAt = nowIso();
  await settingsRef(clinicId).set(
    {
      pendingLinkCode: null,
      pendingLinkCodeExpiresAt: null,
      updatedAt,
    },
    { merge: true },
  );

  return {
    ...record,
    pendingLinkCode: null,
    pendingLinkCodeExpiresAt: null,
    updatedAt,
  };
}

async function loadTargetsForClinic(clinicId: string) {
  const snapshot = await firestoreDb().collection(TARGETS_COLLECTION).where("clinicId", "==", clinicId).get();

  return snapshot.docs.map((doc) =>
    normalizeTargetRecord(clinicId, doc.data(), {
      clinicCode: typeof doc.data().clinicCode === "string" ? doc.data().clinicCode : "",
      clinicName: typeof doc.data().clinicName === "string" ? doc.data().clinicName : "",
      telegramChatId: typeof doc.data().telegramChatId === "string" ? doc.data().telegramChatId : "",
      telegramChatType:
        doc.data().telegramChatType === "private" ||
        doc.data().telegramChatType === "group" ||
        doc.data().telegramChatType === "supergroup" ||
        doc.data().telegramChatType === "channel"
          ? doc.data().telegramChatType
          : "private",
      telegramChatTitle: typeof doc.data().telegramChatTitle === "string" ? doc.data().telegramChatTitle : null,
    }),
  );
}

async function ensureLegacyTargetMigrated(record: TelegramIntegrationRecord) {
  if (!record.telegramChatId || !record.telegramChatType) {
    return;
  }

  const existingTargetSnapshot = await targetRef(record.clinicId, record.telegramChatId).get();
  if (!existingTargetSnapshot.exists) {
    const legacyTarget: TelegramTargetRecord = {
      clinicId: record.clinicId,
      clinicCode: record.clinicCode,
      clinicName: record.clinicName,
      telegramChatId: record.telegramChatId,
      telegramChatType: record.telegramChatType,
      telegramChatTitle: record.telegramChatTitle,
      telegramLinkedAt: record.telegramLinkedAt,
      isTodayAppointmentReportEnabled: record.isTodayAppointmentReportEnabled,
      reportTime: record.reportTime,
      isTodayPaymentReportEnabled: record.isTodayPaymentReportEnabled,
      paymentReportTime: record.paymentReportTime,
      timezone: record.timezone,
      lastTestSentAt: record.lastTestSentAt,
      lastScheduledSentAt: record.lastScheduledSentAt,
      lastScheduledDateKey: record.lastScheduledDateKey,
      lastPaymentTestSentAt: record.lastPaymentTestSentAt,
      lastPaymentScheduledSentAt: record.lastPaymentScheduledSentAt,
      lastPaymentScheduledDateKey: record.lastPaymentScheduledDateKey,
      lastAppointmentFailureAt: record.lastAppointmentFailureAt,
      lastAppointmentFailureReason: record.lastAppointmentFailureReason,
      lastPaymentFailureAt: record.lastPaymentFailureAt,
      lastPaymentFailureReason: record.lastPaymentFailureReason,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };

    await targetRef(record.clinicId, record.telegramChatId).set(legacyTarget, { merge: true });
  }

  await chatLinkRef(record.telegramChatId).set(
    {
      clinicId: record.clinicId,
      clinicCode: record.clinicCode,
      clinicName: record.clinicName,
      telegramChatId: record.telegramChatId,
      telegramChatType: record.telegramChatType,
      telegramChatTitle: record.telegramChatTitle,
      linkedAt: record.telegramLinkedAt ?? record.updatedAt ?? nowIso(),
    },
    { merge: true },
  );
}

async function migrateLegacyTargetsForClinic(record: TelegramIntegrationRecord) {
  if (record.telegramChatId) {
    await ensureLegacyTargetMigrated(record);
  }
}

async function listAllSettingsRecords() {
  const snapshot = await firestoreDb().collection(SETTINGS_COLLECTION).get();
  return snapshot.docs.map((doc) => normalizeRecord(doc.id, doc.data()));
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
  await migrateLegacyTargetsForClinic(cleanedRecord);
  const targets = await loadTargetsForClinic(input.clinicId);
  const deliveries = await loadDeliveryLogsForClinic(input.clinicId);

  return buildStatus(cleanedRecord, targets, deliveries);
}

export async function updateTelegramReportSettings(input: {
  clinicId: string;
  clinicCode?: string;
  clinicName?: string;
  chatId: string;
  isTodayAppointmentReportEnabled: boolean;
  reportTime: string;
  isTodayPaymentReportEnabled: boolean;
  paymentReportTime: string;
  timezone: string;
}) {
  const clinicStatus = await getTelegramIntegrationStatus({
    clinicId: input.clinicId,
    clinicCode: input.clinicCode,
    clinicName: input.clinicName,
  });
  const existingTarget = clinicStatus.linkedTargets.find((target) => target.telegramChatId === input.chatId);

  if (!existingTarget) {
    throw new HttpError(404, "Linked Telegram target not found for this clinic.");
  }

  const timestamp = nowIso();
  const nextTarget: TelegramTargetRecord = {
    ...existingTarget,
    clinicCode: input.clinicCode ?? existingTarget.clinicCode,
    clinicName: input.clinicName ?? existingTarget.clinicName,
    isTodayAppointmentReportEnabled: Boolean(input.isTodayAppointmentReportEnabled),
    reportTime: normalizeReportTime(input.reportTime),
    isTodayPaymentReportEnabled: Boolean(input.isTodayPaymentReportEnabled),
    paymentReportTime: normalizeReportTime(input.paymentReportTime),
    timezone: normalizeTimeZone(input.timezone),
    updatedAt: timestamp,
    createdAt: existingTarget.createdAt ?? timestamp,
  };

  await targetRef(input.clinicId, input.chatId).set(nextTarget, { merge: true });
  await settingsRef(input.clinicId).set(
    {
      clinicCode: input.clinicCode ?? clinicStatus.clinicCode,
      clinicName: input.clinicName ?? clinicStatus.clinicName,
      updatedAt: timestamp,
      createdAt: clinicStatus.createdAt ?? timestamp,
    },
    { merge: true },
  );

  return getTelegramIntegrationStatus({
    clinicId: input.clinicId,
    clinicCode: input.clinicCode,
    clinicName: input.clinicName,
  });
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
  let redeemedClinicId = "";
  let redeemedClinicCode = "";
  let redeemedClinicName = "";

  await firestoreDb().runTransaction(async (transaction) => {
    const codeSnapshot = await transaction.get(linkCodeRef(codeValue));
    if (!codeSnapshot.exists) {
      throw new HttpError(404, "Telegram link code not found or already expired.");
    }

    const linkRecord = codeSnapshot.data() as TelegramLinkCodeRecord | undefined;
    if (!linkRecord) {
      throw new HttpError(404, "Telegram link code is invalid.");
    }

    redeemedClinicId = linkRecord.clinicId;
    redeemedClinicCode = linkRecord.clinicCode;
    redeemedClinicName = linkRecord.clinicName;

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
    const existingTargetSnapshot = await transaction.get(targetRef(linkRecord.clinicId, input.chat.id));
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

    const timestamp = nowIso();
    const existingTarget = normalizeTargetRecord(linkRecord.clinicId, existingTargetSnapshot.data(), {
      clinicCode: linkRecord.clinicCode,
      clinicName: linkRecord.clinicName,
      telegramChatId: input.chat.id,
      telegramChatType: input.chat.type,
      telegramChatTitle: input.chat.title,
    });

    const nextTarget: TelegramTargetRecord = {
      ...existingTarget,
      clinicCode: linkRecord.clinicCode,
      clinicName: linkRecord.clinicName,
      telegramChatId: input.chat.id,
      telegramChatType: input.chat.type,
      telegramChatTitle: input.chat.title,
      telegramLinkedAt: timestamp,
      updatedAt: timestamp,
      createdAt: existingTarget.createdAt ?? timestamp,
    };

    transaction.set(targetRef(linkRecord.clinicId, input.chat.id), nextTarget, { merge: true });
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
      settingsRef(linkRecord.clinicId),
      {
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
      },
      { merge: true },
    );
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
  });

  return getTelegramIntegrationStatus({
    clinicId: redeemedClinicId,
    clinicCode: redeemedClinicCode,
    clinicName: redeemedClinicName,
  });
}

export async function unlinkTelegramIntegration(input: {
  clinicId: string;
  chatId: string;
}) {
  const clinicStatus = await getTelegramIntegrationStatus({ clinicId: input.clinicId });
  const existingTarget = clinicStatus.linkedTargets.find((target) => target.telegramChatId === input.chatId);

  if (!existingTarget) {
    throw new HttpError(404, "Telegram target not found for this clinic.");
  }

  const timestamp = nowIso();
  const shouldClearLegacySummary = clinicStatus.telegramChatId === input.chatId;

  await firestoreDb().runTransaction(async (transaction) => {
    const existingChatLinkSnapshot = await transaction.get(chatLinkRef(input.chatId));
    const existingChatLink = existingChatLinkSnapshot.data() as { clinicId?: string } | undefined;

    transaction.delete(targetRef(input.clinicId, input.chatId));

    if (existingChatLink?.clinicId === input.clinicId) {
      transaction.delete(chatLinkRef(input.chatId));
    }

    if (shouldClearLegacySummary) {
      transaction.set(
        settingsRef(input.clinicId),
        {
          telegramChatId: null,
          telegramChatType: null,
          telegramChatTitle: null,
          telegramLinkedAt: null,
          updatedAt: timestamp,
        },
        { merge: true },
      );
    }
  });

  return getTelegramIntegrationStatus({ clinicId: input.clinicId });
}

function sanitizeTelegramErrorMessage(errorMessage: string | null | undefined) {
  if (!errorMessage?.trim()) {
    return "Telegram delivery failed.";
  }

  return errorMessage.trim().slice(0, 300);
}

async function createTelegramDeliveryLog(entry: TelegramDeliveryLogRecord) {
  const docRef = deliveryLogsCollection().doc();
  await docRef.set(entry);
}

export async function markTelegramDeliverySent(input: {
  clinicId: string;
  clinicCode?: string;
  clinicName?: string;
  chatId: string;
  reportType: TelegramReportType;
  trigger: TelegramDeliveryTrigger;
  sentAt: string;
  dateKey: string | null;
  timezone: string;
  appointmentCount?: number;
  paymentCount?: number;
  totalPaymentAmount?: number;
}) {
  const targetSnapshot = await targetRef(input.clinicId, input.chatId).get();
  const targetRecord = normalizeTargetRecord(input.clinicId, targetSnapshot.data(), {
    clinicCode: input.clinicCode,
    clinicName: input.clinicName,
    telegramChatId: input.chatId,
    telegramChatType: "private",
    telegramChatTitle: null,
  });

  await Promise.all([
    createTelegramDeliveryLog({
      clinicId: input.clinicId,
      clinicCode: input.clinicCode ?? targetRecord.clinicCode,
      clinicName: input.clinicName ?? targetRecord.clinicName,
      telegramChatId: input.chatId,
      reportType: input.reportType,
      trigger: input.trigger,
      outcome: "sent",
      attemptedAt: input.sentAt,
      dateKey: input.dateKey,
      timezone: normalizeTimeZone(input.timezone),
      appointmentCount: input.appointmentCount ?? null,
      paymentCount: input.paymentCount ?? null,
      totalPaymentAmount: input.totalPaymentAmount ?? null,
      errorMessage: null,
    }),
    targetRef(input.clinicId, input.chatId).set(
      input.reportType === "appointment"
        ? {
            ...(input.trigger === "scheduled"
              ? {
                  lastScheduledSentAt: input.sentAt,
                  lastScheduledDateKey: input.dateKey,
                }
              : {
                  lastTestSentAt: input.sentAt,
                }),
            lastAppointmentFailureAt: null,
            lastAppointmentFailureReason: null,
            updatedAt: input.sentAt,
          }
        : {
            ...(input.trigger === "scheduled"
              ? {
                  lastPaymentScheduledSentAt: input.sentAt,
                  lastPaymentScheduledDateKey: input.dateKey,
                }
              : {
                  lastPaymentTestSentAt: input.sentAt,
                }),
            lastPaymentFailureAt: null,
            lastPaymentFailureReason: null,
            updatedAt: input.sentAt,
          },
      { merge: true },
    ),
  ]);
}

export async function markTelegramDeliveryFailed(input: {
  clinicId: string;
  clinicCode?: string;
  clinicName?: string;
  chatId: string;
  reportType: TelegramReportType;
  trigger: TelegramDeliveryTrigger;
  attemptedAt: string;
  dateKey: string | null;
  timezone: string;
  errorMessage: string;
}) {
  const targetSnapshot = await targetRef(input.clinicId, input.chatId).get();
  const targetRecord = normalizeTargetRecord(input.clinicId, targetSnapshot.data(), {
    clinicCode: input.clinicCode,
    clinicName: input.clinicName,
    telegramChatId: input.chatId,
    telegramChatType: "private",
    telegramChatTitle: null,
  });
  const errorMessage = sanitizeTelegramErrorMessage(input.errorMessage);

  await Promise.all([
    createTelegramDeliveryLog({
      clinicId: input.clinicId,
      clinicCode: input.clinicCode ?? targetRecord.clinicCode,
      clinicName: input.clinicName ?? targetRecord.clinicName,
      telegramChatId: input.chatId,
      reportType: input.reportType,
      trigger: input.trigger,
      outcome: "failed",
      attemptedAt: input.attemptedAt,
      dateKey: input.dateKey,
      timezone: normalizeTimeZone(input.timezone),
      appointmentCount: null,
      paymentCount: null,
      totalPaymentAmount: null,
      errorMessage,
    }),
    targetRef(input.clinicId, input.chatId).set(
      input.reportType === "appointment"
        ? {
            lastAppointmentFailureAt: input.attemptedAt,
            lastAppointmentFailureReason: errorMessage,
            updatedAt: input.attemptedAt,
          }
        : {
            lastPaymentFailureAt: input.attemptedAt,
            lastPaymentFailureReason: errorMessage,
            updatedAt: input.attemptedAt,
          },
      { merge: true },
    ),
  ]);
}

export async function listTelegramIntegrationsForScheduling() {
  const settingsRecords = await listAllSettingsRecords();
  await Promise.all(settingsRecords.map((record) => migrateLegacyTargetsForClinic(record)));
  const targets = await firestoreDb().collection(TARGETS_COLLECTION).get();

  return targets.docs
    .map((doc) =>
      normalizeTargetRecord(doc.data().clinicId as string, doc.data(), {
        clinicCode: typeof doc.data().clinicCode === "string" ? doc.data().clinicCode : "",
        clinicName: typeof doc.data().clinicName === "string" ? doc.data().clinicName : "",
        telegramChatId: typeof doc.data().telegramChatId === "string" ? doc.data().telegramChatId : "",
        telegramChatType:
          doc.data().telegramChatType === "private" ||
          doc.data().telegramChatType === "group" ||
          doc.data().telegramChatType === "supergroup" ||
          doc.data().telegramChatType === "channel"
            ? doc.data().telegramChatType
            : "private",
        telegramChatTitle: typeof doc.data().telegramChatTitle === "string" ? doc.data().telegramChatTitle : null,
      }),
    )
    .filter(
      (record) =>
        Boolean(record.telegramChatId) &&
        (record.isTodayAppointmentReportEnabled || record.isTodayPaymentReportEnabled),
    );
}

export async function tryAcquireTelegramScheduleLock(input: {
  clinicId: string;
  chatId: string;
  reportType: TelegramReportType;
  dateKey: string;
}) {
  const lockId = `${encodeURIComponent(input.clinicId)}_${encodeURIComponent(input.chatId)}_${input.reportType}_${input.dateKey}`;
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
      chatId: input.chatId,
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
