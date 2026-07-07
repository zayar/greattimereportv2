import { firestoreDb } from "../../config/firebase.js";
import type {
  AiRevenueAction,
  AiRevenueActionStatus,
  AiRevenueServiceUsageSnapshot,
} from "../../types/ai-revenue-agent.js";
import {
  generateAiRevenueMessage,
  getAiRevenueAction,
  getAiRevenueRunSummary,
  hasAiRevenueActionsForDate,
  listAiRevenueActions,
} from "../ai-revenue-agent/ai-revenue-agent.service.js";
import { getTelegramTargetByChatId } from "./storage.service.js";
import type { TelegramChatType } from "./types.js";
import {
  formatCustomerPhone,
  type CustomerPhoneViewerContext,
} from "./customer-phone.js";
import { formatDateKeyInTimeZone, normalizeTimeZone } from "./time.js";

const FOLLOW_UP_SESSION_COLLECTION = "gt_ai_revenue_telegram_followup_sessions";
const FOLLOW_UP_SESSION_TTL_MS = 20 * 60 * 60_000;
const MAX_TELEGRAM_FOLLOW_UP_TASKS = 5;
const LINKED_CHAT_ERROR =
  "This Telegram chat is not linked to a GreatTime clinic yet. Link it from GreatTime Settings > Telegram first.";
const NO_SESSION_MESSAGE = "No active AI Revenue follow-up list found. Send /followups first.";
const TERMINAL_STATUSES = new Set<AiRevenueActionStatus>([
  "completed",
  "revenue_attributed",
  "closed",
  "skipped",
  "not_interested",
]);

type AiRevenueTelegramFollowUpSession = {
  clinicId: string;
  clinicCode: string;
  chatId: string;
  telegramUserId: string | null;
  dateKey: string;
  actionIdsByIndex: Record<string, string>;
  createdAt: string;
  expiresAt: string;
};

type ParsedSessionCommand = {
  index: number;
  mode: "detail" | "message";
};

type FollowUpCounts = {
  dueNow: number;
  overdue: number;
  highPriority: number;
  contactedToday: number;
  completedToday: number;
};

export function cleanText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim().replace(/[ \t]+/g, " ") : fallback;
}

export function truncateLine(text: string, maxLength: number) {
  const oneLine = cleanText(text).replace(/\s*\n+\s*/g, " ");
  if (oneLine.length <= maxLength) {
    return oneLine;
  }

  return `${oneLine.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function nowIso() {
  return new Date().toISOString();
}

function sessionCollection() {
  return firestoreDb().collection(FOLLOW_UP_SESSION_COLLECTION);
}

function sessionDocId(params: { clinicId: string; chatId: string; dateKey: string }) {
  return `${encodeURIComponent(params.clinicId)}__${encodeURIComponent(params.chatId)}__${params.dateKey}`;
}

function normalizeSession(data: FirebaseFirestore.DocumentData | undefined): AiRevenueTelegramFollowUpSession | null {
  if (
    !data ||
    typeof data.clinicId !== "string" ||
    typeof data.chatId !== "string" ||
    typeof data.dateKey !== "string" ||
    !data.actionIdsByIndex ||
    typeof data.actionIdsByIndex !== "object"
  ) {
    return null;
  }

  return {
    clinicId: data.clinicId,
    clinicCode: typeof data.clinicCode === "string" ? data.clinicCode : "",
    chatId: data.chatId,
    telegramUserId: typeof data.telegramUserId === "string" ? data.telegramUserId : null,
    dateKey: data.dateKey,
    actionIdsByIndex: Object.fromEntries(
      Object.entries(data.actionIdsByIndex as Record<string, unknown>)
        .filter(([index, actionId]) => /^\d+$/.test(index) && typeof actionId === "string" && actionId.trim())
        .map(([index, actionId]) => [index, String(actionId)]),
    ),
    createdAt: typeof data.createdAt === "string" ? data.createdAt : nowIso(),
    expiresAt: typeof data.expiresAt === "string" ? data.expiresAt : nowIso(),
  };
}

export async function createAiRevenueTelegramFollowUpSession(input: {
  clinicId: string;
  clinicCode: string;
  chatId: string;
  telegramUserId?: string | null;
  dateKey: string;
  actionIdsByIndex: Record<string, string>;
}) {
  const timestamp = nowIso();
  const record: AiRevenueTelegramFollowUpSession = {
    clinicId: input.clinicId,
    clinicCode: input.clinicCode,
    chatId: input.chatId,
    telegramUserId: input.telegramUserId ?? null,
    dateKey: input.dateKey,
    actionIdsByIndex: input.actionIdsByIndex,
    createdAt: timestamp,
    expiresAt: new Date(Date.now() + FOLLOW_UP_SESSION_TTL_MS).toISOString(),
  };

  await sessionCollection().doc(sessionDocId(input)).set(record, { merge: true });
  return record;
}

export async function readAiRevenueTelegramFollowUpSession(input: {
  clinicId: string;
  chatId: string;
  dateKey: string;
}) {
  const snapshot = await sessionCollection().doc(sessionDocId(input)).get();
  const record = normalizeSession(snapshot.data());
  if (!record || new Date(record.expiresAt).getTime() <= Date.now()) {
    return null;
  }

  return record;
}

function stripAskPrefix(text: string) {
  return text.trim().replace(/^\/(?:ask|gt|agent)(?:@\w+)?(?:\s+|$)/i, "").trim();
}

function normalizeIntentText(text: string) {
  return stripAskPrefix(text)
    .toLowerCase()
    .replace(/follow[\s-]*up/g, "follow up")
    .replace(/[?!.,:;'"`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isAiRevenueFollowUpTelegramText(text: string): boolean {
  const trimmed = text.trim();
  if (/^\/(?:followups|fu|followup|revenuefollowups|revenue-followups)(?:@\w+)?$/i.test(trimmed)) {
    return true;
  }

  const normalized = normalizeIntentText(trimmed);
  if (!normalized) {
    return false;
  }

  const phrases = [
    "who should i follow up",
    "who should i follow up today",
    "who to follow up",
    "who to follow up today",
    "who do i follow up",
    "which customer should i follow up",
    "which customers should i follow up",
    "follow up list",
    "follow up queue",
    "follow up today",
    "today follow up",
    "today opportunity",
    "customer follow up today",
    "ဒီနေ့ follow up",
    "ဒီနေ့ ဘယ်သူ follow up",
    "ဘယ်သူကို ဆက်သွယ်ရမလဲ",
  ].map(normalizeIntentText);

  if (phrases.some((phrase) => normalized === phrase || normalized.includes(phrase))) {
    return true;
  }

  const asksWhoForFollowUp =
    /\b(?:who|which customers?)\b/.test(normalized) &&
    /\bfollow up\b/.test(normalized) &&
    !/\b(?:why|explain|history|message|draft|detail|details)\b/.test(normalized);
  if (asksWhoForFollowUp) {
    return true;
  }

  return /\b(?:show|list|get|give me)\b.*\bfollow up(?:s)?\b.*\b(?:today|list|queue|customers?)\b/.test(normalized);
}

function parseSessionCommand(text: string): ParsedSessionCommand | null {
  const trimmed = text.trim();
  const compactMatch = trimmed.match(/^F\s*(\d{1,2})\s*([DM])$/i);
  if (compactMatch?.[1] && compactMatch[2]) {
    return {
      index: Number(compactMatch[1]),
      mode: compactMatch[2].toUpperCase() === "D" ? "detail" : "message",
    };
  }

  const detailMatch = trimmed.match(/^\/fdetail(?:@\w+)?\s+(\d{1,2})$/i);
  if (detailMatch?.[1]) {
    return { index: Number(detailMatch[1]), mode: "detail" };
  }

  const messageMatch = trimmed.match(/^\/fmessage(?:@\w+)?\s+(\d{1,2})$/i);
  if (messageMatch?.[1]) {
    return { index: Number(messageMatch[1]), mode: "message" };
  }

  return null;
}

export function isAiRevenueFollowUpSessionCommand(text: string): boolean {
  return parseSessionCommand(text) !== null;
}

export function formatPriority(priority: AiRevenueAction["priority"]) {
  return priority.toUpperCase();
}

function dateKeyFromText(value: unknown) {
  const match = cleanText(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

function numberOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundedPositive(value: unknown) {
  const parsed = numberOrNull(value);
  return parsed != null && parsed > 0 ? Math.round(parsed) : null;
}

function evidenceValue(action: AiRevenueAction, labels: string[]) {
  const labelSet = new Set(labels.map((label) => label.toLowerCase()));
  return action.evidence.find((item) => labelSet.has(item.label.toLowerCase()))?.value;
}

export function getFocusUsage(action: AiRevenueAction): AiRevenueServiceUsageSnapshot | null {
  const usage = action.serviceUsage ?? [];
  return (
    usage.find((item) => item.isFocusService) ??
    usage.find((item) => Number(item.remaining) > 0) ??
    usage[0] ??
    null
  );
}

export function getServiceLabel(action: AiRevenueAction) {
  const usage = getFocusUsage(action);
  return truncateLine(
    cleanText(usage?.serviceName) ||
      cleanText(action.service.serviceName) ||
      cleanText(action.appointment.serviceName) ||
      cleanText(action.packageInfo.packageName) ||
      cleanText(evidenceValue(action, ["Service"])) ||
      "Previous service",
    80,
  );
}

function getLastVisitDateKey(action: AiRevenueAction) {
  const usage = getFocusUsage(action);
  return (
    dateKeyFromText(usage?.latestUsageDate) ??
    dateKeyFromText(action.service.lastVisitDate) ??
    dateKeyFromText(action.packageInfo.lastUsedAt) ??
    dateKeyFromText(evidenceValue(action, ["Last visit date", "Last usage date"]))
  );
}

export function getLastVisitLabel(action: AiRevenueAction) {
  const lastVisit = getLastVisitDateKey(action);
  return lastVisit ? `Last visit ${lastVisit}` : null;
}

function getBalanceParts(action: AiRevenueAction) {
  const usage = getFocusUsage(action);
  const usageRemaining = roundedPositive(usage?.remaining);
  if (usageRemaining != null) {
    const used = numberOrNull(usage?.used);
    const total = roundedPositive(usage?.packageTotal) ?? (used != null ? Math.round(used + usageRemaining) : null);
    return {
      remaining: usageRemaining,
      used: used == null ? null : Math.max(0, Math.round(used)),
      total,
    };
  }

  const packageRemaining = roundedPositive(action.packageInfo.remainingUnits);
  if (packageRemaining == null) {
    return null;
  }

  const used = numberOrNull(action.packageInfo.usedUnits);
  const total = roundedPositive(action.packageInfo.purchasedUnits) ?? (used != null ? Math.round(used + packageRemaining) : null);
  return {
    remaining: packageRemaining,
    used: used == null ? null : Math.max(0, Math.round(used)),
    total,
  };
}

export function getPackageBalanceLabel(action: AiRevenueAction) {
  const balance = getBalanceParts(action);
  if (!balance) {
    return null;
  }

  return balance.total ? `${balance.remaining}/${balance.total} sessions left` : `${balance.remaining} sessions left`;
}

function getDaysSinceLastVisit(action: AiRevenueAction, dateKey?: string) {
  const direct =
    roundedPositive(action.service.lastVisitSinceDays) ??
    roundedPositive(evidenceValue(action, ["Days since last visit", "Days since activity"]));
  if (direct != null) {
    return direct;
  }

  const lastVisit = getLastVisitDateKey(action);
  if (!lastVisit || !dateKey) {
    return null;
  }

  const later = new Date(`${dateKey}T00:00:00.000Z`);
  const earlier = new Date(`${lastVisit}T00:00:00.000Z`);
  if (Number.isNaN(later.getTime()) || Number.isNaN(earlier.getTime())) {
    return null;
  }

  return Math.max(0, Math.round((later.getTime() - earlier.getTime()) / 86_400_000));
}

function firstSentence(text: string) {
  const cleaned = cleanText(text).replace(/\s*\n+\s*/g, " ");
  return cleaned.split(/(?<=[.!?။])\s+/)[0] ?? cleaned;
}

function removeZeroBalancePhrases(text: string) {
  return cleanText(text)
    .replace(/\b0\s*\/\s*\d+\s*(?:sessions?|session|ကြိမ်)\s*(?:left|remaining|ကျန်\w*)?/gi, "")
    .replace(/\b(?:sessions?|session)\s*(?:left|remaining)\s*0\b/gi, "")
    .replace(/\b0\s*(?:sessions?|session)\s*(?:left|remaining)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function getWhyLine(action: AiRevenueAction, dateKey?: string) {
  const balance = getPackageBalanceLabel(action);
  if (balance) {
    return truncateLine([getLastVisitLabel(action), balance].filter(Boolean).join(" · "), 90);
  }

  if (action.actionType === "service_reminder_follow_up" || action.actionType === "service_reminder_overdue") {
    const days = getDaysSinceLastVisit(action, dateKey);
    if (days != null) {
      return `${days} days since last visit`;
    }
    return getLastVisitLabel(action) ?? `Previous service: ${getServiceLabel(action)}`;
  }

  if (action.actionType === "no_show_recovery") {
    return "Recent no-show; no new appointment found";
  }

  if (action.actionType === "cancelled_appointment_recovery") {
    return "Cancelled appointment; no recovery booking found";
  }

  if (action.actionType === "inactive_vip_recovery") {
    const days = getDaysSinceLastVisit(action, dateKey);
    return days != null ? `High-value customer inactive for ${days} days` : "High-value customer inactive";
  }

  if (action.actionType === "payment_follow_up") {
    return "Payment follow-up needed";
  }

  const fallback = removeZeroBalancePhrases(firstSentence(action.displayReason || action.reason));
  return truncateLine(fallback || getLastVisitLabel(action) || `Previous service: ${getServiceLabel(action)}`, 90);
}

function defaultDoLine(action: AiRevenueAction) {
  if (getPackageBalanceLabel(action)) {
    return "Viber/call and book next session";
  }

  if (action.actionType === "no_show_recovery" || action.actionType === "cancelled_appointment_recovery") {
    return "Recover the booking and offer a new appointment time";
  }

  if (action.actionType === "payment_follow_up") {
    return "Confirm payment status and follow up politely";
  }

  return "Confirm service and invite for next appointment";
}

export function getDoLine(action: AiRevenueAction) {
  const direct = firstSentence(cleanText(action.aiSuggestion) || cleanText(action.recommendedAction));
  return truncateLine(removeZeroBalancePhrases(direct) || defaultDoLine(action), 100);
}

export function getPhoneLabel(action: AiRevenueAction, viewerContext: CustomerPhoneViewerContext) {
  return formatCustomerPhone(
    {
      fullPhone: action.customer.phoneNumber,
      maskedPhone: action.customer.phoneMasked,
    },
    viewerContext,
    { logContext: "ai_revenue_follow_up" },
  );
}

function dueDateKey(action: AiRevenueAction) {
  return action.dueDateKey ?? action.dateKey;
}

function isTelegramQueueAction(action: AiRevenueAction, dateKey: string) {
  const visibilityState = action.visibilityState ?? "active";
  return (
    visibilityState === "active" &&
    dueDateKey(action) <= dateKey &&
    !TERMINAL_STATUSES.has(action.status)
  );
}

function sortForMobile(left: AiRevenueAction, right: AiRevenueAction) {
  const priorityRank = { high: 0, medium: 1, low: 2 };
  return (
    priorityRank[left.priority] - priorityRank[right.priority] ||
    right.priorityScore - left.priorityScore ||
    dueDateKey(left).localeCompare(dueDateKey(right)) ||
    right.updatedAt.localeCompare(left.updatedAt)
  );
}

function dateKeyFromIso(value: string | null | undefined) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

function buildCounts(actions: AiRevenueAction[], dateKey: string): FollowUpCounts {
  return {
    dueNow: actions.filter((action) => dueDateKey(action) === dateKey).length,
    overdue: actions.filter((action) => dueDateKey(action) < dateKey).length,
    highPriority: actions.filter((action) => action.priority === "high").length,
    contactedToday: actions.filter(
      (action) => dateKeyFromIso(action.lastContactAt) === dateKey || dateKeyFromIso(action.followUp.lastContactedAt) === dateKey,
    ).length,
    completedToday: actions.filter(
      (action) =>
        dateKeyFromIso(action.completedAt) === dateKey ||
        dateKeyFromIso(action.followUp.completedAt) === dateKey ||
        (action.visibilityState === "completed" && dateKeyFromIso(action.lastStatusAt) === dateKey),
    ).length,
  };
}

function customerName(action: AiRevenueAction) {
  return truncateLine(cleanText(action.customer.customerName, "Customer"), 70);
}

export function formatAiRevenueTaskListMessage(input: {
  dateKey: string;
  actions: AiRevenueAction[];
  counts: FollowUpCounts;
  chatType: TelegramChatType;
  viewerContext: CustomerPhoneViewerContext;
}) {
  if (input.chatType !== "private") {
    return [
      "📊 AI Revenue Follow-up",
      `Date: ${input.dateKey}`,
      "",
      `Due now: ${input.counts.dueNow}`,
      `Overdue: ${input.counts.overdue}`,
      `High priority: ${input.counts.highPriority}`,
      `Contacted today: ${input.counts.contactedToday}`,
      `Completed today: ${input.counts.completedToday}`,
      "",
      "Sales focus:",
      "Work top high-priority package/service follow-ups first.",
      "",
      "Open in private chat for customer details.",
    ].join("\n");
  }

  const lines = [
    "📌 AI Revenue Follow-up",
    `Date: ${input.dateKey}`,
    "",
    `Due now: ${input.counts.dueNow} | Overdue: ${input.counts.overdue}`,
  ];

  if (input.actions.length === 0) {
    lines.push("", "No open AI Revenue follow-ups for today.");
    return lines.join("\n");
  }

  lines.push(`Showing top ${input.actions.length}.`, "");
  input.actions.forEach((action, index) => {
    const displayIndex = index + 1;
    lines.push(
      `${displayIndex}) ${customerName(action)} — ${formatPriority(action.priority)}`,
      `☎ ${getPhoneLabel(action, input.viewerContext)}`,
      `Service: ${getServiceLabel(action)}`,
      `Why: ${getWhyLine(action, input.dateKey)}`,
      `Do: ${getDoLine(action)}`,
      `Reply: F${displayIndex}D detail | F${displayIndex}M msg`,
    );
    if (displayIndex < input.actions.length) {
      lines.push("");
    }
  });

  return lines.join("\n");
}

function therapistName(action: AiRevenueAction) {
  const usage = getFocusUsage(action);
  return (
    cleanText(usage?.latestTherapist) ||
    cleanText(action.service.lastTreatmentTherapist) ||
    cleanText(action.service.preferredTherapist) ||
    cleanText(action.appointment.practitionerName)
  );
}

function detailReason(action: AiRevenueAction) {
  if (getPackageBalanceLabel(action)) {
    return "Prepaid sessions remain and customer has not returned.";
  }
  if (action.actionType === "no_show_recovery") {
    return "Recent no-show; no new appointment found.";
  }
  if (action.actionType === "cancelled_appointment_recovery") {
    return "Cancelled appointment; no recovery booking found.";
  }
  if (action.actionType === "inactive_vip_recovery") {
    return "High-value customer inactive.";
  }
  if (action.actionType === "payment_follow_up") {
    return "Payment follow-up is needed.";
  }

  return truncateLine(removeZeroBalancePhrases(firstSentence(action.displayReason || action.reason)), 140);
}

export function formatAiRevenueTaskDetailMessage(input: {
  action: AiRevenueAction;
  index: number;
  dateKey: string;
  viewerContext: CustomerPhoneViewerContext;
}) {
  const action = input.action;
  const lines = [
    `Customer Detail — F${input.index}`,
    "",
    `Customer: ${customerName(action)}`,
    `Phone: ${getPhoneLabel(action, input.viewerContext)}`,
    "",
    "Service:",
    getServiceLabel(action),
  ];
  const patternLines: string[] = [];
  const lastVisit = getLastVisitDateKey(action);
  const daysSince = getDaysSinceLastVisit(action, input.dateKey);
  const therapist = therapistName(action);
  if (lastVisit) {
    patternLines.push(`Last visit: ${lastVisit}`);
  }
  if (daysSince != null) {
    patternLines.push(`Days since: ${daysSince}`);
  }
  if (therapist) {
    patternLines.push(`Therapist: ${truncateLine(therapist, 70)}`);
  }

  if (patternLines.length > 0) {
    lines.push("", "Pattern:", ...patternLines);
  }

  const balance = getBalanceParts(action);
  if (balance) {
    lines.push("", "Balance:");
    if (balance.used != null && balance.total != null) {
      lines.push(`Used: ${balance.used} / ${balance.total}`);
    }
    lines.push(`Remaining: ${balance.remaining}`);
  }

  const reason = detailReason(action);
  if (reason) {
    lines.push("", "Reason:", reason);
  }
  lines.push("", "Next:", getDoLine(action));

  return lines.join("\n");
}

function compactMessageText(text: string) {
  return cleanText(text)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function formatAiRevenueCustomerDraftMessage(input: {
  index: number;
  messageText: string;
}) {
  return [
    `Message — F${input.index}`,
    "",
    compactMessageText(input.messageText),
    "",
    "Copy this to Viber. No automatic message was sent.",
  ].join("\n");
}

function noDataMessage(dateKey: string) {
  return [
    "AI Revenue Follow-up",
    `Date: ${dateKey}`,
    "",
    "No follow-up data for today yet.",
    "The AI Revenue Agent schedule has not run yet.",
    "Please check again after today's schedule run.",
  ].join("\n");
}

async function hasLegacyRunEvidenceFromSameDayActions(input: {
  clinicId: string;
  dateKey: string;
}) {
  return hasAiRevenueActionsForDate({
    clinicId: input.clinicId,
    dateKey: input.dateKey,
  });
}

async function buildSessionCommandReply(input: {
  clinicId: string;
  chatId: string;
  chatType: TelegramChatType;
  telegramUserId?: string | null;
  dateKey: string;
  command: ParsedSessionCommand;
  viewerContext: CustomerPhoneViewerContext;
}) {
  if (input.chatType !== "private") {
    return input.command.mode === "detail"
      ? "Customer detail is available only in private sales chat."
      : "Customer message is available only in private sales chat.";
  }

  const session = await readAiRevenueTelegramFollowUpSession({
    clinicId: input.clinicId,
    chatId: input.chatId,
    dateKey: input.dateKey,
  });
  if (!session) {
    return NO_SESSION_MESSAGE;
  }

  const actionId = session.actionIdsByIndex[String(input.command.index)];
  if (!actionId) {
    return `No AI Revenue follow-up task found for F${input.command.index}. Send /followups again.`;
  }

  let action = await getAiRevenueAction({
    clinicId: input.clinicId,
    actionId,
  });

  if (input.command.mode === "detail") {
    return formatAiRevenueTaskDetailMessage({
      action,
      index: input.command.index,
      dateKey: input.dateKey,
      viewerContext: input.viewerContext,
    });
  }

  if (!cleanText(action.message.approvedText) && !cleanText(action.message.draftText)) {
    action = await generateAiRevenueMessage({
      clinicId: input.clinicId,
      actionId,
    });
  }

  return formatAiRevenueCustomerDraftMessage({
    index: input.command.index,
    messageText: cleanText(action.message.approvedText) || cleanText(action.message.draftText) || "No customer message draft is available.",
  });
}

export async function buildAiRevenueFollowUpTelegramReply(input: {
  chatId: string;
  chatType: TelegramChatType;
  text: string;
  telegramUserId?: string | null;
}) {
  const target = await getTelegramTargetByChatId(input.chatId);
  if (!target) {
    return LINKED_CHAT_ERROR;
  }

  const timezone = normalizeTimeZone(target.timezone);
  const dateKey = formatDateKeyInTimeZone(new Date(), timezone);
  const viewerContext: CustomerPhoneViewerContext = {
    chatType: input.chatType,
    telegramUserId: input.telegramUserId ?? null,
    target,
  };
  const sessionCommand = parseSessionCommand(input.text);
  if (sessionCommand) {
    return buildSessionCommandReply({
      clinicId: target.clinicId,
      chatId: input.chatId,
      chatType: input.chatType,
      telegramUserId: input.telegramUserId ?? null,
      dateKey,
      command: sessionCommand,
      viewerContext,
    });
  }

  const runSummary = await getAiRevenueRunSummary({
    clinicId: target.clinicId,
    dateKey,
  });
  const hasRunData = runSummary || (await hasLegacyRunEvidenceFromSameDayActions({
    clinicId: target.clinicId,
    dateKey,
  }));
  if (!hasRunData) {
    return noDataMessage(dateKey);
  }

  const { actions } = await listAiRevenueActions({
    clinicId: target.clinicId,
    queueView: "today",
    limit: 500,
    includeResolved: false,
  });
  const queueActions = actions
    .filter((action) => isTelegramQueueAction(action, dateKey))
    .sort(sortForMobile);
  const topActions = queueActions.slice(0, MAX_TELEGRAM_FOLLOW_UP_TASKS);
  const counts = buildCounts(queueActions, dateKey);

  if (input.chatType === "private" && topActions.length > 0) {
    await createAiRevenueTelegramFollowUpSession({
      clinicId: target.clinicId,
      clinicCode: target.clinicCode,
      chatId: input.chatId,
      telegramUserId: input.telegramUserId ?? null,
      dateKey,
      actionIdsByIndex: Object.fromEntries(topActions.map((action, index) => [String(index + 1), action.id])),
    });
  }

  return formatAiRevenueTaskListMessage({
    dateKey,
    actions: topActions,
    counts,
    chatType: input.chatType,
    viewerContext,
  });
}

export const __test = {
  parseSessionCommand,
  buildCounts,
  isTelegramQueueAction,
  sortForMobile,
};
