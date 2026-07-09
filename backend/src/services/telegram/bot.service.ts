import { createHash } from "node:crypto";
import { env } from "../../config/env.js";
import { HttpError } from "../../utils/http-error.js";
import { hasFeatureAccess } from "../feature-access.service.js";
import { askAgentHub, buildLockedAgentHubResponse } from "../agent-hub/agent-hub.service.js";
import { isAgentCsvExportRequested, isExportOnlyFollowUp } from "../agent-hub/export-intent.js";
import { hasExplicitPeriodCue } from "../agent-hub/intent-planner.js";
import { buildCustomerKey } from "../agent-hub/customer-identity.js";
import { maskPhone, nowIso, sanitizeError } from "../agent-hub/safety.js";
import { updateAgentRunTrace, saveAgentRunTrace } from "../agent-hub/trace.repository.js";
import { redactMonitoringText } from "../agent-hub/monitoring/agent-monitoring.service.js";
import type {
  Customer360FactPack,
  GreatTimeAgentChatResponse,
  GreatTimeAgentEntityContext,
  GreatTimeAgentId,
  GreatTimeAgentMetric,
  GreatTimeAgentTableColumn,
} from "../agent-hub/types.js";
import { buildTelegramSalesAssistantReply } from "../gt-growth-ai/sales-assistant.service.js";
import { GT_GROWTH_AI_FEATURE_GATE } from "../../types/report-ai.js";
import {
  buildAiRevenueFollowUpTelegramReply,
  isAiRevenueFollowUpSessionCommand,
  isAiRevenueFollowUpTelegramText,
} from "./ai-revenue-follow-up.service.js";
import {
  buildGreatTimeAgentCsvCaption,
  buildGreatTimeAgentCsvExportFromTables,
} from "./agent-csv-export.service.js";
import {
  getLatestTelegramAgentExportCache,
  getTelegramAgentExportCacheById,
  saveLatestTelegramAgentExportCache,
} from "./agent-export-cache.js";
import { getTelegramTargetByChatId, redeemTelegramLinkCode } from "./storage.service.js";
import type { TelegramChatTarget, TelegramTargetStatus } from "./types.js";
import {
  appointmentContextItemToCustomerEntityContext,
  getRecentAppointmentContext,
  resolveRecentAppointmentReference,
  saveRecentAppointmentContext,
  type RecentAppointmentContext,
  type RecentAppointmentContextItem,
} from "./appointment-context.js";
import {
  getRecentPaymentMethodContext,
  resolveRecentPaymentMethodReference,
  saveRecentPaymentMethodContext,
  type RecentPaymentMethodContextItem,
} from "./payment-method-context.js";
import {
  canViewFullCustomerPhone,
  formatCustomerPhone,
  type CustomerPhoneViewerContext,
} from "./customer-phone.js";

type TelegramChat = {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  first_name?: string;
  last_name?: string;
};

type TelegramMessage = {
  message_id: number;
  text?: string;
  chat: TelegramChat;
  from?: {
    id?: number;
  };
};

type TelegramChatMember = {
  status?: string;
};

type TelegramChatMemberUpdate = {
  chat: TelegramChat;
  old_chat_member?: TelegramChatMember;
  new_chat_member?: TelegramChatMember;
};

type TelegramCallbackQuery = {
  id: string;
  data?: string;
  message?: TelegramMessage;
  from?: {
    id?: number;
  };
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
  my_chat_member?: TelegramChatMemberUpdate;
  callback_query?: TelegramCallbackQuery;
};

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

export type TelegramWebhookInfo = {
  url?: string;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
};

let cachedBotUsername: string | null | undefined;
let pollingStarted = false;
const suggestedQuestionCallbacks = new Map<string, { question: string; createdAt: number }>();
const SUGGESTED_QUESTION_TTL_MS = 60 * 60_000;
const customerActionCallbacks = new Map<string, { entityContext: GreatTimeAgentEntityContext; createdAt: number }>();
const CUSTOMER_ACTION_TTL_MS = 15 * 60_000;
type AppointmentCallbackToken = {
  action: "select" | "page";
  clinicId?: string;
  telegramChatId?: string;
  telegramUserId?: string | null;
  appointmentId?: string;
  customerId?: string;
  page?: number;
  createdAt: number;
  expiresAt: number;
};
const appointmentActionCallbacks = new Map<string, AppointmentCallbackToken>();
const APPOINTMENT_ACTION_TTL_MS = 15 * 60_000;

function getTelegramApiUrl(method: string) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new HttpError(500, "TELEGRAM_BOT_TOKEN is required for Telegram integration.");
  }

  return `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
}

async function callTelegramApi<T>(method: string, body?: Record<string, unknown>) {
  let response: Response;

  try {
    response = await fetch(getTelegramApiUrl(method), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(env.TELEGRAM_API_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new HttpError(504, `Telegram API request timed out for ${method}.`);
    }

    throw error;
  }

  const responseText = await response.text();
  let payload: TelegramApiResponse<T>;

  try {
    payload = responseText ? (JSON.parse(responseText) as TelegramApiResponse<T>) : { ok: false };
  } catch {
    throw new HttpError(502, `Telegram API returned an invalid response for ${method}.`);
  }

  if (!response.ok) {
    throw new HttpError(response.status, payload.description || `Telegram API request failed for ${method}.`);
  }

  if (!payload.ok || payload.result === undefined) {
    throw new HttpError(502, payload.description || `Telegram API request failed for ${method}.`);
  }

  return payload.result;
}

async function callTelegramMultipartApi<T>(method: string, formData: FormData) {
  let response: Response;

  try {
    response = await fetch(getTelegramApiUrl(method), {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(env.TELEGRAM_API_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new HttpError(504, `Telegram API request timed out for ${method}.`);
    }

    throw error;
  }

  const responseText = await response.text();
  let payload: TelegramApiResponse<T>;

  try {
    payload = responseText ? (JSON.parse(responseText) as TelegramApiResponse<T>) : { ok: false };
  } catch {
    throw new HttpError(502, `Telegram API returned an invalid response for ${method}.`);
  }

  if (!response.ok) {
    throw new HttpError(response.status, payload.description || `Telegram API request failed for ${method}.`);
  }

  if (!payload.ok || payload.result === undefined) {
    throw new HttpError(502, payload.description || `Telegram API request failed for ${method}.`);
  }

  return payload.result;
}

function buildChatTitle(chat: TelegramChat) {
  if (chat.title?.trim()) {
    return chat.title.trim();
  }

  const fullName = [chat.first_name, chat.last_name].filter(Boolean).join(" ").trim();
  return fullName || "Telegram chat";
}

function extractLinkCode(text: string) {
  const trimmed = text.trim();
  const commandMatch =
    trimmed.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9-]{6,24})$/i) ??
    trimmed.match(/^\/link(?:@\w+)?\s+([A-Za-z0-9-]{6,24})$/i);

  if (commandMatch?.[1]) {
    return commandMatch[1].toUpperCase();
  }

  if (/^[A-Za-z0-9-]{6,24}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  return null;
}

async function sendUsageMessage(chatId: string) {
  await sendTelegramMessage(
    chatId,
    [
      "GT Telegram link ready.",
      "",
      "Private chat: send your link code here.",
      "Group chat: send /link CODE after adding the bot to the group.",
      "",
      "GT Growth AI commands for paid clinics:",
      "/tasks, /today, C1, B1, P1, S1, M1",
      "",
      "Agent chat when enabled:",
      "/ask How much did we collect today?",
    ].join("\n"),
  );
}

function isSalesAssistantCommand(text: string) {
  const trimmed = text.trim();
  return (
    /^\/tasks(?:@\w+)?$/i.test(trimmed) ||
    /^\/today(?:@\w+)?$/i.test(trimmed) ||
    /^([CBPSM])\s*(\d{1,2})$/i.test(trimmed) ||
    /^\/(contacted|booked|purchased|skipped|message)(?:@\w+)?\s+\d{1,2}$/i.test(trimmed)
  );
}

export function extractTelegramAgentQuestion(text: string, chatType: TelegramChat["type"]) {
  const trimmed = text.trim();
  const commandMatch = trimmed.match(/^\/(?:ask|gt|agent)(?:@\w+)?(?:\s+([\s\S]+))?$/i);

  if (commandMatch) {
    return commandMatch[1]?.trim() || "";
  }

  if (chatType === "private" && !trimmed.startsWith("/")) {
    return trimmed;
  }

  return null;
}

export function canTelegramUserChatWithAgent(params: {
  target: Pick<TelegramTargetStatus, "isAgentChatEnabled" | "agentChatAccessMode" | "agentChatAllowedUserIds">;
  telegramUserId: string | null;
}) {
  if (!params.target.isAgentChatEnabled) {
    return false;
  }

  if (params.target.agentChatAccessMode === "all_members") {
    return true;
  }

  return Boolean(params.telegramUserId && params.target.agentChatAllowedUserIds.includes(params.telegramUserId));
}

function formatMetricValue(value: string | number, unit: string | undefined) {
  const formatted =
    typeof value === "number"
      ? value.toLocaleString("en-US", unit === "amount" ? { maximumFractionDigits: 0 } : undefined)
      : value;
  if (unit === "amount") {
    return `${formatted} ကျပ်`;
  }
  if (unit === "%") {
    return `${formatted}%`;
  }

  return unit ? `${formatted} ${unit}` : formatted;
}

function formatTelegramNumber(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) {
    return value == null || value === "" ? "-" : String(value);
  }

  return Math.round(num).toLocaleString("en-US");
}

function formatTelegramMoney(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) {
    return value == null || value === "" ? "-" : String(value);
  }

  return `${Math.round(num).toLocaleString("en-US")} ကျပ်`;
}

function formatAgentLabel(agentId: GreatTimeAgentId) {
  switch (agentId) {
    case "finance":
      return "Finance Agent";
    case "customer_relationship":
      return "Customer Relationship Agent";
    case "business":
      return "Business Agent";
    case "appointment":
      return "Appointment Agent";
    default:
      return "GT Agent";
  }
}

function formatAgentLabelMyanmar(agentId: GreatTimeAgentId) {
  switch (agentId) {
    case "finance":
      return "ငွေကြေး Agent";
    case "customer_relationship":
      return "Customer Relationship Agent";
    case "business":
      return "Business Agent";
    case "appointment":
      return "Appointment Agent";
    default:
      return "GT Agent";
  }
}

function formatShortDate(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return dateKey;
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function translatePeriodLabel(label: string) {
  const normalized = label.toLowerCase();
  if (normalized === "today") {
    return "ဒီနေ့";
  }
  if (normalized === "yesterday") {
    return "မနေ့";
  }
  if (normalized === "this month") {
    return "ဒီလ";
  }
  if (normalized === "this week") {
    return "ဒီအပတ်";
  }
  if (normalized === "last 30 days") {
    return "ပြီးခဲ့တဲ့ ၃၀ ရက်";
  }
  if (normalized === "last 90 days") {
    return "ပြီးခဲ့တဲ့ ၉၀ ရက်";
  }
  if (normalized === "last 365 days") {
    return "ပြီးခဲ့တဲ့ ၃၆၅ ရက်";
  }
  if (normalized === "next 30 days") {
    return "နောက် 30 ရက်";
  }
  if (normalized === "next 60 days") {
    return "နောက် 60 ရက်";
  }
  if (normalized === "next 90 days") {
    return "နောက် 90 ရက်";
  }
  if (normalized === "year to date") {
    return "ဒီနှစ်အစမှ ယနေ့အထိ";
  }

  return label;
}

function formatResponsePeriod(response: GreatTimeAgentChatResponse) {
  const { period } = response;
  if (period.fromDate === period.toDate) {
    return `${translatePeriodLabel(period.label)} (${period.toDate})`;
  }

  return `${translatePeriodLabel(period.label)} (${period.fromDate} to ${period.toDate})`;
}

function buildTelegramReplyHeader(response: GreatTimeAgentChatResponse) {
  const agentLabel = formatAgentLabelMyanmar(response.resolvedAgent);
  const answeredBy = response.autoMode ? `GT Brain → ${agentLabel}` : agentLabel;

  return ["GT Brain", `ဖြေဆိုသူ: ${answeredBy}`, `ကာလ: ${formatResponsePeriod(response)}`];
}

function ownerBodyPeriodPrefix(period: GreatTimeAgentChatResponse["period"]) {
  const normalized = period.label.toLowerCase();
  if (normalized === "today") {
    return "ဒီနေ့";
  }
  if (normalized === "yesterday") {
    return "မနေ့က";
  }
  if (normalized === "this week") {
    return "ဒီအပတ်";
  }
  if (normalized === "this month") {
    return "ဒီလ";
  }
  if (normalized === "next 30 days") {
    return "နောက် 30 ရက်";
  }
  if (normalized === "next 60 days") {
    return "နောက် 60 ရက်";
  }
  if (normalized === "next 90 days") {
    return "နောက် 90 ရက်";
  }
  if (period.fromDate !== period.toDate) {
    return `${period.fromDate} မှ ${period.toDate} အထိ`;
  }

  return period.toDate;
}

function stringValue(row: Record<string, unknown>, key: string, fallback = "-") {
  const value = row[key];
  return value == null || value === "" ? fallback : String(value);
}

function numberValue(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isNumericLike(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value === "string" && value.trim()) {
    return Number.isFinite(Number(value));
  }

  return false;
}

function apicoreAppointmentWallClockParts(value: string) {
  const text = value.trim().replace(/(?:Z|[+-]\d{2}:?\d{2})$/i, "");
  const match = text
    .match(/^(\d{4})-(\d{2})-(\d{2})[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:\s*(AM|PM))?$/i);
  if (!match) {
    return null;
  }

  let hour = Number(match[4]);
  const meridiem = match[7]?.toUpperCase();
  if (meridiem === "AM") {
    hour = hour === 12 ? 0 : hour;
  } else if (meridiem === "PM") {
    hour = hour === 12 ? 12 : hour + 12;
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour,
    minute: Number(match[5]),
    second: Number(match[6] ?? "0"),
  };
}

function formatDateTimeForOwner(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return "-";
  }

  const wallClockParts = apicoreAppointmentWallClockParts(value);
  if (wallClockParts) {
    return `${String(wallClockParts.hour).padStart(2, "0")}:${String(wallClockParts.minute).padStart(2, "0")}`;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: env.DEFAULT_TIMEZONE,
  });
}

function translateStatus(value: string) {
  const normalized = value.trim().toUpperCase();
  if (["CHECKOUT", "CHECKED_OUT"].includes(normalized)) {
    return "ပြီးဆုံး";
  }
  if (["CHECKIN", "CHECK_IN"].includes(normalized)) {
    return "ရောက်ရှိ";
  }
  if (["BOOKED", "BOOKING", "REQUEST", "REQUESTED"].includes(normalized)) {
    return "ချိန်းထား";
  }
  if (normalized.includes("CANCEL")) {
    return "ဖျက်ထား";
  }
  if (normalized === "NO_SHOW") {
    return "မလာ";
  }

  return value || "-";
}

function translateMetricLabel(label: string) {
  const normalized = label.toLowerCase();
  const map: Record<string, string> = {
    appointments: "Appointment စုစုပေါင်း",
    services: "Service အမျိုးအစား",
    "open / upcoming": "ဖွင့်/လာရန်ရှိ",
    "checked out": "ပြီးဆုံး",
    cancelled: "ဖျက်ထား",
    "no-show": "မလာ",
    revenue: "ဝင်ငွေ",
    bookings: "Booking",
    customers: "Customer",
    treatments: "Treatment",
    practitioners: "Practitioner",
    "active practitioners": "Active practitioner",
    "customers served": "Service ပေးထားသော customer",
    "average utilization": "ပျမ်းမျှ utilization",
    "total bookings": "Booking စုစုပေါင်း",
    "distinct services": "Service အမျိုးအစား",
    "avg bookings/service": "Service တစ်ခုလျှင် ပျမ်းမျှ booking",
    collected: "စုဆောင်းငွေ",
    "total sales": "ရောင်းအားစုစုပေါင်း",
    invoices: "Invoice",
    "average invoice": "Invoice တစ်စောင်ပျမ်းမျှ",
    "matched customers": "တွေ့ရှိသော customer",
    "source lookback days": "စစ်ထားတဲ့ နောက်ကြည့်ရက်",
  };

  return map[normalized] ?? label;
}

function appointmentTableFromResponse(response: GreatTimeAgentChatResponse) {
  const table = (
    response.tables?.find((table) => table.title === "Appointments") ??
    response.tables?.find((table) => /appointment/i.test(table.title) && table.title !== "Appointment services")
  );

  if (table || response.resolvedAgent !== "appointment") {
    return table;
  }

  return response.tables?.find((item) => item.title !== "Appointment services" && item.rows.length > 0);
}

function appointmentSortValue(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return Number.POSITIVE_INFINITY;
  }

  const text = value.trim();
  const wallClockParts = apicoreAppointmentWallClockParts(text);
  if (wallClockParts) {
    return Date.UTC(
      wallClockParts.year,
      wallClockParts.month - 1,
      wallClockParts.day,
      wallClockParts.hour,
      wallClockParts.minute,
      wallClockParts.second,
    );
  }

  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: env.DEFAULT_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "0";

    return Date.UTC(
      Number(part("year")),
      Number(part("month")) - 1,
      Number(part("day")),
      Number(part("hour")),
      Number(part("minute")),
      Number(part("second")),
    );
  }

  const timeMatch = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (timeMatch) {
    return Number(timeMatch[1]) * 60 * 60 + Number(timeMatch[2]) * 60 + Number(timeMatch[3] ?? "0");
  }

  return Number.POSITIVE_INFINITY;
}

function appointmentRefForRow(
  response: GreatTimeAgentChatResponse,
  row: Record<string, unknown>,
  index: number,
) {
  const appointmentId = stringValue(row, "appointmentId", "");
  const refs = response.entityRefs ?? [];

  return (
    refs.find((ref) => ref.entityType === "appointment" && appointmentId && ref.appointmentId === appointmentId) ??
    refs.find((ref) => ref.entityType === "appointment" && ref.rank === index + 1) ??
    refs.filter((ref) => ref.entityType === "appointment")[index]
  );
}

function sortedAppointmentRowsFromResponse(response: GreatTimeAgentChatResponse) {
  const appointmentTable = appointmentTableFromResponse(response);
  const rows = appointmentTable?.rows ?? [];

  return rows
    .map((row, index) => {
      const ref = appointmentRefForRow(response, row, index);
      const rawTime = ref?.appointmentTime ?? stringValue(row, "scheduledFrom", stringValue(row, "checkInTime", ""));

      return {
        row,
        originalIndex: index,
        sortValue: appointmentSortValue(rawTime),
      };
    })
    .sort((left, right) => left.sortValue - right.sortValue || left.originalIndex - right.originalIndex);
}

export function buildRecentAppointmentContextItemsFromResponse(params: {
  response: GreatTimeAgentChatResponse;
  viewerContext?: CustomerPhoneViewerContext;
  clinicCode: string;
}) {
  const rows = sortedAppointmentRowsFromResponse(params.response);
  const canStoreFullPhone = canViewFullCustomerPhone(params.viewerContext);

  return rows.slice(0, 30).map<RecentAppointmentContextItem>(({ row, originalIndex }, index) => {
    const ref = appointmentRefForRow(params.response, row, originalIndex);
    const appointmentId = ref?.appointmentId ?? stringValue(row, "appointmentId", `appointment-${index + 1}`);
    const customerName = ref?.customerName ?? ref?.displayName ?? stringValue(row, "customerName", "Unknown customer");
    const rawFullPhone = ref?.customerPhone ?? stringValue(row, "customerPhone", "");
    const maskedPhone = ref?.customerPhoneMasked ?? stringValue(row, "customerPhoneMasked", maskPhone(rawFullPhone));
    const serviceName = ref?.serviceName ?? stringValue(row, "serviceName", "Unknown service");
    const staffName = ref?.practitionerName ?? stringValue(row, "practitionerName", stringValue(row, "therapistName", ""));
    const rawTime = ref?.appointmentTime ?? stringValue(row, "scheduledFrom", stringValue(row, "checkInTime", ""));
    const rawStatus = ref?.appointmentStatus ?? stringValue(row, "rawStatus", stringValue(row, "lifecycleState", ""));
    const customerId =
      ref?.customerKey ??
      buildCustomerKey({
        clinicCode: params.clinicCode,
        phoneNumber: rawFullPhone,
        customerName,
      });

    return {
      displayIndex: index + 1,
      appointmentId,
      customerId,
      customerName,
      fullPhone: rawFullPhone && canStoreFullPhone ? rawFullPhone : undefined,
      resolutionPhone: rawFullPhone || undefined,
      maskedPhone: maskedPhone || maskPhone(rawFullPhone),
      memberId: ref?.memberId,
      serviceName,
      staffName,
      appointmentTime: formatDateTimeForOwner(rawTime),
      appointmentStatus: translateStatus(rawStatus),
    };
  });
}

function metricNumber(response: GreatTimeAgentChatResponse, label: string) {
  const value = response.metrics?.find((metric) => metric.label.toLowerCase() === label.toLowerCase())?.value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function metricValue(response: GreatTimeAgentChatResponse, labels: string[]) {
  for (const label of labels) {
    const value = response.metrics?.find((metric) => metric.label.toLowerCase() === label.toLowerCase())?.value;
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function appointmentCountForIntent(response: GreatTimeAgentChatResponse, fallback: number) {
  if (response.intent === "cancelled_no_show") {
    const cancelled = metricNumber(response, "Cancelled");
    const noShow = metricNumber(response, "No-show");
    if (cancelled !== undefined || noShow !== undefined) {
      return (cancelled ?? 0) + (noShow ?? 0);
    }
  }

  const labelsByIntent: Record<string, string[]> = {
    appointment_list: ["Appointments", "Total appointments today", "Total appointments"],
    appointment_summary: ["Total appointments today", "Total appointments", "Appointments"],
    checked_in_customers: ["Checked in now"],
    checked_out_customers: ["Checked out"],
    not_checked_out_customers: ["Not checked out yet"],
    arrived_not_started_customers: ["Arrived but not started treatment", "Arrived not checked out proxy"],
  };

  return metricValue(response, labelsByIntent[response.intent] ?? ["Appointments"]) ?? fallback;
}

function appointmentCountLineForIntent(response: GreatTimeAgentChatResponse, count: string | number) {
  const countText = formatMetricValue(count, undefined);
  const periodPrefix = ownerBodyPeriodPrefix(response.period);
  const checkInPrefix = response.period.label.toLowerCase() === "today" ? "အခု" : periodPrefix;

  switch (response.intent) {
    case "checked_in_customers":
      return `${checkInPrefix} check-in လုပ်ပြီး checkout မလုပ်သေးတဲ့ customer ${countText} ယောက်ရှိပါတယ်။`;
    case "checked_out_customers":
      return `${periodPrefix} checkout လုပ်ပြီးသူ ${countText} ယောက်ရှိပါတယ်။`;
    case "not_checked_out_customers":
      return `${periodPrefix} checkout မလုပ်သေးတဲ့ appointment ${countText} ခုရှိပါတယ်။`;
    case "arrived_not_started_customers": {
      const proxy = response.warnings?.some((warning) => warning.type === "treatment_start_unavailable");
      return proxy
        ? `${periodPrefix} ရောက်ရှိပြီး checkout မလုပ်သေးတဲ့ customer ${countText} ယောက်ရှိပါတယ်။ Treatment စတင်ချိန် data မရှိသေးလို့ proxy အနေနဲ့ပြထားပါတယ်။`
        : `${periodPrefix} ရောက်ရှိပြီး treatment မစသေးတဲ့ customer ${countText} ယောက်ရှိပါတယ်။`;
    }
    case "cancelled_no_show":
      return `${periodPrefix} ဖျက်ထား/မလာ appointment ${countText} ခုရှိပါတယ်။`;
    case "appointment_list":
    case "appointment_summary":
    default:
      return `${periodPrefix} appointment booking ${countText} ခုရှိပါတယ်။`;
  }
}

type TelegramAppointmentFilter = {
  practitionerName?: string;
  serviceName?: string;
  sourceRowCount?: number;
};

function appointmentFilterFromResponse(response: GreatTimeAgentChatResponse): TelegramAppointmentFilter | null {
  const raw = response.data?.appointmentFilter;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const practitionerName = typeof record.practitionerName === "string" && record.practitionerName.trim()
    ? record.practitionerName.trim()
    : undefined;
  const serviceName = typeof record.serviceName === "string" && record.serviceName.trim()
    ? record.serviceName.trim()
    : undefined;
  const sourceRowCount = typeof record.sourceRowCount === "number" && Number.isFinite(record.sourceRowCount)
    ? record.sourceRowCount
    : undefined;

  if (!practitionerName && !serviceName && sourceRowCount === undefined) {
    return null;
  }

  return { practitionerName, serviceName, sourceRowCount };
}

function appointmentFilterLine(filter: TelegramAppointmentFilter | null) {
  if (!filter) {
    return null;
  }

  const parts = [
    filter.practitionerName ? `Staff: ${filter.practitionerName}` : null,
    filter.serviceName ? `Service: ${filter.serviceName}` : null,
  ].filter((part): part is string => Boolean(part));

  return parts.length ? `Filter: ${parts.join("၊ ")}` : null;
}

function appointmentFilterSubject(filter: TelegramAppointmentFilter | null) {
  if (!filter) {
    return "";
  }

  return [filter.practitionerName, filter.serviceName].filter(Boolean).join("၊ ");
}

type TelegramTreatmentDetailFilter = {
  practitionerName?: string;
  serviceName?: string;
  requestedServiceName?: string;
  fuzzyMatchedServiceName?: string;
  suggestedServices?: string[];
  totalLoadedRows?: number;
};

function treatmentDetailFilterFromResponse(response: GreatTimeAgentChatResponse): TelegramTreatmentDetailFilter | null {
  const raw = response.data?.treatmentDetailFilter;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const practitionerName = typeof record.practitionerName === "string" && record.practitionerName.trim()
    ? record.practitionerName.trim()
    : undefined;
  const serviceName = typeof record.serviceName === "string" && record.serviceName.trim()
    ? record.serviceName.trim()
    : undefined;
  const requestedServiceName = typeof record.requestedServiceName === "string" && record.requestedServiceName.trim()
    ? record.requestedServiceName.trim()
    : undefined;
  const fuzzyMatchedServiceName = typeof record.fuzzyMatchedServiceName === "string" && record.fuzzyMatchedServiceName.trim()
    ? record.fuzzyMatchedServiceName.trim()
    : undefined;
  const suggestedServices = Array.isArray(record.suggestedServices)
    ? record.suggestedServices.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : undefined;
  const totalLoadedRows = typeof record.totalLoadedRows === "number" && Number.isFinite(record.totalLoadedRows)
    ? record.totalLoadedRows
    : undefined;

  if (!practitionerName && !serviceName && !requestedServiceName && totalLoadedRows === undefined) {
    return null;
  }

  return { practitionerName, serviceName, requestedServiceName, fuzzyMatchedServiceName, suggestedServices, totalLoadedRows };
}

function treatmentDetailFilterLine(filter: TelegramTreatmentDetailFilter | null) {
  if (!filter) {
    return null;
  }

  const parts = [
    filter.serviceName ? `Service: ${filter.serviceName}` : null,
    filter.practitionerName ? `Therapist: ${filter.practitionerName}` : null,
  ].filter((part): part is string => Boolean(part));

  return parts.length ? `Filter: ${parts.join("၊ ")}` : null;
}

function isTreatmentDetailResponse(response: GreatTimeAgentChatResponse) {
  return ["treatment_detail", "service_treatment_detail", "practitioner_treatment_detail"].includes(response.intent);
}

function sanitizeOwnerFacingText(text: string) {
  return text
    .replace(
      /APICORE does not expose a treatment_started_at event here, so this uses booking status as a proxy and does not confirm exact treatment-start time\./gi,
      "Treatment စတင်ချိန်ကို စနစ်ထဲမှာ တိတိကျကျ မတွေ့ရလို့ booking status ကို အခြေခံပြီး ခန့်မှန်းထားပါတယ်။",
    )
    .replace(
      /Treatment\/process start time is not exposed by APICORE in this query, so this list shows checked-in customers who have not checked out\./gi,
      "Treatment စတင်ချိန် data မရှိသေးလို့ check-in လုပ်ပြီး checkout မလုပ်သေးတဲ့ customer များကို proxy အနေနဲ့ပြထားပါတယ်။",
    )
    .replace(/APICORE booking ledger/gi, "appointment စာရင်း")
    .replace(/APICORE appointment ledger/gi, "appointment စာရင်း")
    .replace(/\bAPICORE\b/gi, "appointment စာရင်း")
    .replace(/BigQuery payment report/gi, "payment report")
    .replace(/BigQuery customer portal/gi, "customer report")
    .replace(/No bounded customer match was found for\s+"([^"]+)"/gi, "I couldn’t find a customer named \"$1\".")
    .replace(/Customer match is ambiguous/gi, "Please choose a customer")
    .replace(/Multiple customers matched this name\. The agent will not silently choose between them\./gi, "I found more than one customer with that name. Please choose one.")
    .replace(/agent will not silently choose/gi, "please choose one")
    .replace(/bounded customer match/gi, "customer match")
    .replace(/\bresolver\b/gi, "lookup")
    .replace(/\bdatabase\b/gi, "records")
    .replace(/\bambiguous match\b/gi, "multiple matches")
    .replace(/\bBigQuery\b/gi, "report data");
}

function formatAppointmentConversation(response: GreatTimeAgentChatResponse, viewerContext?: CustomerPhoneViewerContext, clinicCode = "") {
  const appointmentTable = appointmentTableFromResponse(response);
  const appointmentRows = sortedAppointmentRowsFromResponse(response);
  const appointmentFilter = appointmentFilterFromResponse(response);
  const appointmentContextItems = buildRecentAppointmentContextItemsFromResponse({
    response,
    viewerContext,
    clinicCode,
  });
  const totalAppointments = appointmentCountForIntent(response, appointmentTable?.rows.length ?? appointmentContextItems.length);
  const total = typeof totalAppointments === "number" ? totalAppointments : appointmentTable?.rows.length ?? appointmentContextItems.length;
  const filterLine = appointmentFilterLine(appointmentFilter);
  const filterSubject = appointmentFilterSubject(appointmentFilter);
  const countLine =
    appointmentRows.length === 0 && filterSubject
      ? `${ownerBodyPeriodPrefix(response.period)} ${filterSubject} အတွက် appointment booking မတွေ့ပါ။`
      : appointmentCountLineForIntent(response, totalAppointments);
  const lines = [countLine];

  if (filterLine) {
    lines.push(filterLine);
  }

  if (appointmentRows.length) {
    if (appointmentContextItems.length > appointmentPageSize()) {
      const bounds = appointmentPageBounds(appointmentContextItems.length, 0);
      if (typeof total === "number" && total > appointmentContextItems.length) {
        lines.push(
          `Showing ${bounds.start + 1}-${bounds.end} of ${appointmentContextItems.length.toLocaleString("en-US")} loaded appointment bookings. Full total: ${total.toLocaleString("en-US")} appointment bookings.`,
        );
      } else {
        lines.push(`Showing ${bounds.start + 1}-${bounds.end} of ${appointmentContextItems.length.toLocaleString("en-US")} appointment bookings`);
      }
    }

    appointmentRows.slice(0, 30).forEach(({ row }, index) => {
      const contextItem = appointmentContextItems[index];
      const time = contextItem?.appointmentTime ?? formatDateTimeForOwner(row.scheduledFrom);
      const customer = contextItem?.customerName ?? stringValue(row, "customerName", "Unknown customer");
      const service = contextItem?.serviceName ?? stringValue(row, "serviceName", "Unknown service");
      const practitioner = contextItem?.staffName ?? stringValue(row, "practitionerName", "");
      const status = contextItem?.appointmentStatus ?? translateStatus(stringValue(row, "rawStatus", ""));
      const phone = contextItem
        ? formatCustomerPhone(
            { fullPhone: contextItem.fullPhone, maskedPhone: contextItem.maskedPhone },
            viewerContext,
            { logContext: "appointment_list" },
          )
        : stringValue(row, "customerPhoneMasked", "");

      lines.push("");
      lines.push(`${index + 1}. ${time} — ${customer}`);
      lines.push(`Phone: ${phone || "-"}`);
      lines.push(`Service: ${service}`);
      lines.push(`Staff: ${practitioner || "-"}`);
      lines.push(`Status: ${status}`);
    });

    if (appointmentRows.length > 30 || total > 30) {
      const remaining = Math.max(appointmentRows.length, total) - 30;
      lines.push("", `နောက်ထပ် appointment booking ${remaining.toLocaleString("en-US")} ခုကို CSV/report ထဲမှာ ဆက်ကြည့်နိုင်ပါတယ်။`);
    }

    lines.push("", "Customer တစ်ယောက်ကိုရွေးပါ။");
  }

  return lines;
}

function formatDailyTreatmentRosterConversation(response: GreatTimeAgentChatResponse, viewerContext?: CustomerPhoneViewerContext) {
  const table = response.tables?.find((item) => item.title === "Daily treatment records");
  const treatmentFilter = treatmentDetailFilterFromResponse(response);
  const isDetail = isTreatmentDetailResponse(response);

  if (!table?.rows.length) {
    if (!isDetail) {
      return [];
    }

    const service = treatmentFilter?.serviceName ?? treatmentFilter?.requestedServiceName;
    const subject = service
      ? `${ownerBodyPeriodPrefix(response.period)} ${service} treatment/service detail`
      : `${ownerBodyPeriodPrefix(response.period)} treatment/service detail`;
    const lines = [`${subject}:`, "စုစုပေါင်း records: 0"];
    const suggestions = treatmentFilter?.suggestedServices ?? [];

    if (suggestions.length) {
      lines.push("", "Closest services:");
      suggestions.slice(0, 5).forEach((item, index) => {
        lines.push(`${index + 1}. ${item}`);
      });
    }

    lines.push("", "မှတ်ချက်: ဒါက appointment count မဟုတ်ပါ။ Appointment တစ်ခုမှာ service/treatment records များနိုင်ပါတယ်။");
    return lines;
  }

  const filterLine = treatmentDetailFilterLine(treatmentFilter);
  const totalTreatments = metricValue(response, ["Treatments"]) ?? table.rows.length;
  const customers = metricValue(response, ["Distinct treatment customers"]);
  const staff = metricValue(response, ["Practitioners"]);
  const total = typeof totalTreatments === "number" ? totalTreatments : Number(totalTreatments);
  const pageSize = appointmentPageSize();
  const shownRows = table.rows.slice(0, pageSize);
  const totalText = Number.isFinite(total) ? total.toLocaleString("en-US") : formatMetricValue(totalTreatments, undefined);
  const detailSubject = treatmentFilter?.serviceName
    ? `${ownerBodyPeriodPrefix(response.period)} ${treatmentFilter.serviceName} treatment/service detail`
    : treatmentFilter?.practitionerName
      ? `${ownerBodyPeriodPrefix(response.period)} ${treatmentFilter.practitionerName} treatment/service detail`
      : `${ownerBodyPeriodPrefix(response.period)} treatment/service detail`;
  const lines = isDetail
    ? [
        `${detailSubject}:`,
        "",
        `စုစုပေါင်း records: ${totalText}`,
        `Customers: ${formatMetricValue(customers ?? "-", undefined)}`,
        `Staff/Therapists: ${formatMetricValue(staff ?? "-", undefined)}`,
        "",
        "Customer / service detail:",
      ]
    : [
        `${ownerBodyPeriodPrefix(response.period)} customer/service/therapist treatment/service records ${totalText} ခုရှိပါတယ်။`,
        `${ownerBodyPeriodPrefix(response.period)} customer/service/therapist treatment/service records စာရင်း:`,
        "မှတ်ချက်: ဒါက appointment count မဟုတ်ပါ။ Appointment တစ်ခုမှာ service/treatment records များနိုင်ပါတယ်။",
      ];

  if (filterLine) {
    lines.push(filterLine);
  }

  if (table.rows.length > pageSize) {
    if (Number.isFinite(total) && total > table.rows.length) {
      lines.push(
        `Showing 1-${shownRows.length} of ${table.rows.length.toLocaleString("en-US")} loaded treatment/service records. Full total: ${total.toLocaleString("en-US")} treatment/service records.`,
      );
    } else {
      lines.push(`Showing 1-${shownRows.length} of ${table.rows.length.toLocaleString("en-US")} treatment/service records`);
    }
  }

  shownRows.forEach((row, index) => {
    const time = formatDateTimeForOwner(stringValue(row, "checkInTime", ""));
    const customer = stringValue(row, "customerName", "Unknown customer");
    const service = stringValue(row, "serviceName", "Unknown service");
    const therapist = stringValue(row, "therapistName", stringValue(row, "practitionerName", "-"));
    const rawPhone = stringValue(row, "customerPhone", "");
    const maskedPhone = stringValue(row, "customerPhoneMasked", rawPhone ? maskPhone(rawPhone) : "");
    const phone = rawPhone || maskedPhone
      ? formatCustomerPhone(
          { fullPhone: rawPhone || undefined, maskedPhone: maskedPhone || undefined },
          viewerContext,
          { logContext: "daily_treatment_roster" },
        )
      : "";
    const status = stringValue(row, "status", stringValue(row, "rawStatus", ""));

    lines.push("");
    lines.push(`${index + 1}. ${time} — ${customer}`);
    if (phone && phone !== "-") {
      lines.push(`Phone: ${phone}`);
    }
    lines.push(`Service: ${service}`);
    lines.push(`${isDetail ? "Staff" : "Therapist"}: ${therapist}`);
    if (status && status !== "-") {
      lines.push(`Status: ${translateStatus(status)}`);
    }
  });

  if (isDetail) {
    lines.push("", "မှတ်ချက်: ဒါက appointment count မဟုတ်ပါ။ Appointment တစ်ခုမှာ service/treatment records များနိုင်ပါတယ်။");
  }

  const therapistBreakdown = response.tables?.find((item) => item.title === "Therapist breakdown");
  if (therapistBreakdown?.rows.length) {
    lines.push("", "Therapist breakdown:");
    therapistBreakdown.rows.slice(0, 5).forEach((row) => {
      const therapistName = stringValue(row, "therapistName", "Unknown");
      const treatments = numberValue(row, "treatmentsCompleted");
      const customers = numberValue(row, "customersServed");
      const topService = stringValue(row, "topService", "");
      const pieces = [
        `${formatMetricValue(treatments ?? "-", undefined)} records`,
        customers != null ? `${customers.toLocaleString("en-US")} customers` : "",
        topService && topService !== "-" ? `top ${topService}` : "",
      ].filter(Boolean);
      lines.push(`- ${therapistName}: ${pieces.join(", ")}`);
    });
  }

  const serviceBreakdown = response.tables?.find((item) => item.title === "Service breakdown");
  if (serviceBreakdown?.rows.length && !treatmentFilter?.serviceName) {
    lines.push("", "Service breakdown:");
    serviceBreakdown.rows.slice(0, 5).forEach((row) => {
      const serviceName = stringValue(row, "serviceName", "Unknown service");
      const treatments = numberValue(row, "treatmentCount");
      const customers = numberValue(row, "customerCount");
      const therapists = numberValue(row, "therapistCount");
      const pieces = [
        `${formatMetricValue(treatments ?? "-", undefined)} records`,
        customers != null ? `${customers.toLocaleString("en-US")} customers` : "",
        therapists != null ? `${therapists.toLocaleString("en-US")} therapists` : "",
      ].filter(Boolean);
      lines.push(`- ${serviceName}: ${pieces.join(", ")}`);
    });
  }

  return lines;
}

function formatOperationsCountReconciliationConversation(response: GreatTimeAgentChatResponse) {
  const table = response.tables?.find((item) => item.title === "Count reconciliation");
  if (response.intent !== "operations_count_reconciliation" && !table?.rows.length) {
    return [];
  }

  const rows = table?.rows ?? [];
  const appointmentRow = rows.find((row) => /appointment bookings/i.test(stringValue(row, "metric", "")));
  const treatmentRow = rows.find((row) => /treatment\/service records/i.test(stringValue(row, "metric", "")));
  const appointmentValue = appointmentRow ? stringValue(appointmentRow, "value", "-") : formatMetricValue(metricValue(response, ["Appointment bookings"]) ?? "-", undefined);
  const treatmentValue = treatmentRow
    ? stringValue(treatmentRow, "value", "-")
    : formatMetricValue(metricValue(response, ["Treatment/service records"]) ?? "-", undefined);
  const appointmentSource = appointmentRow ? stringValue(appointmentRow, "source", "APICORE booking ledger") : "APICORE booking ledger";
  const treatmentSource = treatmentRow ? stringValue(treatmentRow, "source", "BigQuery daily treatment report") : "BigQuery daily treatment report";
  const appointmentMeaning = appointmentRow ? stringValue(appointmentRow, "definition", "scheduled appointment rows") : "scheduled appointment rows";
  const treatmentMeaning = treatmentRow
    ? stringValue(treatmentRow, "definition", "service/treatment rows by CheckInTime")
    : "customer တစ်ယောက် service/treatment တစ်ခုလုပ်တိုင်း row တစ်ခု";

  return [
    `${ownerBodyPeriodPrefix(response.period)} count နှစ်ခုမတူတာက report type မတူလို့ပါ။`,
    "",
    `1. Appointment booking: ${appointmentValue}`,
    `Source: ${appointmentSource}`,
    `Meaning: ${appointmentMeaning}`,
    "",
    `2. Treatment/service records: ${treatmentValue}`,
    `Source: ${treatmentSource}`,
    `Meaning: ${treatmentMeaning}`,
    "",
    "ဘာကြောင့် treatment records ပိုများနိုင်လဲ:",
    "- Appointment တစ်ခုမှာ service/treatment records များနိုင်ပါတယ်။",
    "- Cancel/no-show appointment တွေက appointment ထဲပါနိုင်ပေမယ့် treatment records ထဲမပါနိုင်ပါ။",
    "- Appointment report က scheduled time ကိုသုံးပြီး treatment report က CheckInTime ကိုသုံးပါတယ်။",
    "- BigQuery analytics report က APICORE live booking data ထက် update နောက်ကျနိုင်ပါတယ်။",
    "",
    "အကြံပြုချက်:",
    "Appointment schedule ကြည့်ချင်ရင် “မနေ့က appointment စာရင်းပြပါ” လို့မေးပါ။",
    "တကယ်လုပ်သွားတဲ့ service/therapist list ကြည့်ချင်ရင် “မနေ့က ဘယ် customer တွေ ဘယ် service ကို ဘယ် therapist နဲ့လုပ်လဲ” လို့မေးပါ။",
  ];
}

function formatPractitionerPerformanceConversation(response: GreatTimeAgentChatResponse) {
  const table = response.tables?.find((item) => item.title === "Practitioner performance");
  if (!table?.rows.length) {
    return [];
  }

  const lines = ["Practitioner performance ကို ဖတ်ရလွယ်အောင် ပြန်ရေးထားပါတယ်:"];
  table.rows.slice(0, 8).forEach((row, index) => {
    const name = stringValue(row, "therapistName", "Practitioner");
    const treatments = numberValue(row, "treatmentsCompleted") ?? 0;
    const customers = numberValue(row, "customersServed") ?? 0;
    const topService = stringValue(row, "topService", "");
    const topServiceText = topService && topService !== "-" ? ` အများဆုံးလုပ်ထားတဲ့ service က ${topService} ပါ။` : "";
    lines.push(
      `${index + 1}. ${name} က treatment ${treatments.toLocaleString("en-US")} ကြိမ်လုပ်ထားပြီး customer ${customers.toLocaleString("en-US")} ယောက်ကို service ပေးထားပါတယ်။${topServiceText}`,
    );
  });

  return lines;
}

function metricByLabel(response: GreatTimeAgentChatResponse, label: string): GreatTimeAgentMetric | undefined {
  return response.metrics?.find((metric) => metric.label.toLowerCase() === label.toLowerCase());
}

function isFinanceSalesSummaryResponse(response: GreatTimeAgentChatResponse) {
  return response.resolvedAgent === "finance" && Boolean(metricByLabel(response, "Total sales"));
}

function isUnknownServiceName(value: string) {
  const normalized = value.trim().toLowerCase();
  return !normalized || normalized === "-" || normalized === "unknown" || normalized === "unknown service";
}

function formatFinanceSalesConversation(response: GreatTimeAgentChatResponse) {
  if (!isFinanceSalesSummaryResponse(response)) {
    return [];
  }

  const totalSales = metricByLabel(response, "Total sales");
  const invoices = metricByLabel(response, "Invoices");
  const customers = metricByLabel(response, "Customers");
  const averageInvoice = metricByLabel(response, "Average invoice");
  const periodLabel = translatePeriodLabel(response.period.label);
  const lines = [`${periodLabel} total sales က ${formatMetricValue(totalSales?.value ?? "-", totalSales?.unit)} ပါ။`];
  const details: string[] = [];

  if (invoices) {
    details.push(`invoice ${formatMetricValue(invoices.value, invoices.unit)} စောင်`);
  }
  if (customers) {
    details.push(`customer ${formatMetricValue(customers.value, customers.unit)} ယောက်`);
  }
  if (averageInvoice) {
    details.push(`average invoice ${formatMetricValue(averageInvoice.value, averageInvoice.unit)}`);
  }
  if (details.length > 0) {
    lines.push(`${details.join("၊ ")}။`);
  }

  const serviceTable = response.tables?.find((item) => /top services by sales|top services|service performance/i.test(item.title));
  const serviceRows = serviceTable?.rows ?? [];
  const knownRows = serviceRows.filter((row) => !isUnknownServiceName(stringValue(row, "serviceName", "")));
  const unknownRevenue = serviceRows
    .filter((row) => isUnknownServiceName(stringValue(row, "serviceName", "")))
    .reduce((sum, row) => sum + (numberValue(row, "totalRevenue") ?? numberValue(row, "revenue") ?? 0), 0);

  if (knownRows.length > 0) {
    lines.push("", "Service သိထားတဲ့ sales breakdown:");
    knownRows.slice(0, 5).forEach((row, index) => {
      const service = stringValue(row, "serviceName", "Service");
      const revenue = numberValue(row, "totalRevenue") ?? numberValue(row, "revenue");
      const invoiceCount = numberValue(row, "invoiceCount");
      const invoiceText = invoiceCount != null ? `၊ invoice ${invoiceCount.toLocaleString("en-US")} စောင်` : "";
      const revenueText = revenue != null ? formatMetricValue(revenue, "amount") : "-";
      lines.push(`${index + 1}. ${service} — ${revenueText}${invoiceText}`);
    });
  }

  if (unknownRevenue > 0) {
    lines.push(
      "",
      `မှတ်ချက်: ${formatMetricValue(unknownRevenue, "amount")} က service name မပါတဲ့ invoice rows ("Unknown") ထဲမှာ ပါနေပါတယ်။ Total sales ထဲမှာ ထည့်တွက်ပြီးသားပါ။`,
    );
  }

  return lines;
}

function formatPaymentMethodsConversation(response: GreatTimeAgentChatResponse) {
  const table =
    response.tables?.find((item) => /payment method/i.test(item.title)) ??
    (response.intent === "payment_method_breakdown" ? response.tables?.find((item) => item.rows.length > 0) : undefined);
  if (!table?.rows.length) {
    return [];
  }

  const periodLabel = translatePeriodLabel(response.period.label);
  const lines = [`${periodLabel} payment method collection summary:`];

  table.rows.slice(0, 10).forEach((row, index) => {
    const method = stringValue(row, "paymentMethod", stringValue(row, "method", "Method"));
    const amount = numberValue(row, "totalAmount") ?? numberValue(row, "amount");
    const transactions =
      numberValue(row, "transactionCount") ??
      numberValue(row, "transactions") ??
      numberValue(row, "count");

    lines.push("");
    lines.push(`${index + 1}. ${method} — ${amount != null ? formatTelegramMoney(amount) : "-"}`);
    if (transactions != null) {
      lines.push(`Transactions: ${formatTelegramNumber(transactions)}`);
    }
  });

  lines.push("", "မှတ်ချက်: ဒါက payment method collection summary ဖြစ်ပါတယ်။ Real bank statement ledger မဟုတ်ပါ။");

  return lines;
}

export function buildRecentPaymentMethodContextItemsFromResponse(
  response: GreatTimeAgentChatResponse,
): RecentPaymentMethodContextItem[] {
  if (response.intent !== "payment_method_breakdown") {
    return [];
  }

  const table =
    response.tables?.find((item) => /payment method/i.test(item.title)) ??
    response.tables?.find((item) => item.rows.length > 0);
  if (!table?.rows.length) {
    return [];
  }

  return table.rows
    .slice(0, 30)
    .map((row, index) => {
      const paymentMethod = stringValue(row, "paymentMethod", stringValue(row, "method", "")).trim();
      if (!paymentMethod || paymentMethod === "-") {
        return null;
      }

      return {
        rank: index + 1,
        paymentMethod,
        totalAmount: numberValue(row, "totalAmount") ?? numberValue(row, "amount") ?? 0,
        transactionCount:
          numberValue(row, "transactionCount") ??
          numberValue(row, "transactions") ??
          numberValue(row, "count") ??
          0,
      };
    })
    .filter((item): item is RecentPaymentMethodContextItem => Boolean(item));
}

function formatPaymentMethodDetailConversation(response: GreatTimeAgentChatResponse) {
  if (response.intent !== "payment_method_detail") {
    return [];
  }

  const table = response.tables?.find((item) => /payment method detail/i.test(item.title));
  const dataPaymentMethod = typeof response.data?.paymentMethod === "string" ? response.data.paymentMethod : "";
  const firstMethod = table?.rows[0] ? stringValue(table.rows[0], "paymentMethod", "") : "";
  const method = dataPaymentMethod || firstMethod || "Selected method";
  const collected =
    response.metrics?.find((metric) => metric.label.toLowerCase().includes("collected")) ??
    response.metrics?.find((metric) => metric.unit === "amount");
  const transactions = metricByLabel(response, "Transactions");
  const mismatchWarning = response.warnings?.find((warning) => warning.type === "payment_method_detail_mismatch");
  const lines = [`Payment method: ${method}`];

  if (collected) {
    lines.push(`${method} total: ${formatMetricValue(collected.value, collected.unit)}`);
  }
  if (transactions) {
    lines.push(`Transactions: ${formatMetricValue(transactions.value, transactions.unit)}`);
  }

  if (!table?.rows.length) {
    const totalText = collected ? `${method} total ${formatMetricValue(collected.value, collected.unit)}` : `${method} total`;
    lines.push(
      "",
      mismatchWarning
        ? `${method} အတွက် payment rows မတွေ့ပါ။ ဒါပေမယ့် summary ထဲမှာ ${totalText} တွေ့ထားပါတယ်။ Detail query/filter mismatch ဖြစ်နိုင်ပါတယ်။ Audit log ကိုစစ်ပါ။`
        : `${method} အတွက် payment rows မတွေ့ပါ။`,
    );
    lines.push("", "မှတ်ချက်: ဒါက GreatTime payment report rows အပေါ်အခြေခံထားတာပါ။ Real bank statement ledger မဟုတ်ပါ။");
    return lines;
  }

  lines.push("", "Details:");
  table.rows.slice(0, 10).forEach((row, index) => {
    const invoice = stringValue(row, "invoiceNumber", "-");
    const customer = stringValue(row, "customerName", "-");
    const phone = stringValue(row, "customerPhone", "");
    const service = stringValue(row, "serviceName", "-");
    const servicePackage = stringValue(row, "servicePackageName", "");
    const paymentAmount = numberValue(row, "paymentAmount");
    const invoiceTotal = numberValue(row, "invoiceNetTotal");
    const status = stringValue(row, "paymentStatus", "");
    const note = stringValue(row, "paymentNote", "");
    const packageText = servicePackage && servicePackage !== "-" ? ` / ${servicePackage}` : "";
    const paymentText = paymentAmount != null ? formatTelegramMoney(paymentAmount) : "-";
    const invoiceTotalText = invoiceTotal != null ? formatTelegramMoney(invoiceTotal) : "-";
    const statusText = status && status !== "-" ? status : "-";
    const noteText = note && note !== "-" ? note : "";

    lines.push(`${index + 1}. Invoice: ${invoice}`);
    lines.push(`   Customer: ${customer}`);
    if (phone && phone !== "-") {
      lines.push(`   Phone: ${phone}`);
    }
    lines.push(`   Service: ${service}${packageText}`);
    lines.push(`   Amount: ${paymentText}`);
    lines.push(`   Invoice total: ${invoiceTotalText}`);
    lines.push(`   Status: ${statusText}`);
    if (noteText) {
      lines.push(`   Note: ${noteText}`);
    }
  });

  lines.push("", "မှတ်ချက်: ဒါက GreatTime payment report rows အပေါ်အခြေခံထားတာပါ။ Real bank statement ledger မဟုတ်ပါ။");

  return lines;
}

function formatServicePerformanceConversation(response: GreatTimeAgentChatResponse) {
  const table = response.tables?.find((item) => /top services|service performance/i.test(item.title));
  if (!table?.rows.length) {
    return [];
  }

  const lines = ["Service အလိုက် owner အတွက် ဖတ်ရလွယ်တဲ့ summary:"];
  table.rows.slice(0, 10).forEach((row, index) => {
    const service = stringValue(row, "serviceName", "Service");
    const bookings = numberValue(row, "bookingCount") ?? numberValue(row, "bookings");
    const customers = numberValue(row, "customerCount") ?? numberValue(row, "totalCustomers");
    const revenue = numberValue(row, "totalRevenue") ?? numberValue(row, "revenue");
    const parts = [`${index + 1}. ${service}`];
    if (bookings != null) {
      parts.push(`booking ${bookings.toLocaleString("en-US")} ခု`);
    }
    if (customers != null) {
      parts.push(`customer ${customers.toLocaleString("en-US")} ယောက်`);
    }
    if (revenue != null) {
      parts.push(`ဝင်ငွေ ${revenue.toLocaleString("en-US")} ကျပ်`);
    }
    lines.push(`${parts.join(" — ")}။`);
  });

  return lines;
}

type TelegramPackageRemainingDetail = {
  packageName: string;
  serviceName?: string | null;
  categoryName?: string | null;
  totalSessions?: number | null;
  usedSessions?: number | null;
  remainingSessions?: number | null;
  remainingAmount?: number | null;
  purchaseDate?: string | null;
  lastUsedDate?: string | null;
  expiryDate?: string | null;
};

function packageRemainingDetailsFromRow(row: Record<string, unknown>): TelegramPackageRemainingDetail[] {
  const rawDetails = row.packageRemainingDetails;
  if (Array.isArray(rawDetails)) {
    return rawDetails
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => ({
        packageName: stringValue(item, "packageName", stringValue(item, "serviceName", "Package balance")),
        serviceName: stringValue(item, "serviceName", ""),
        categoryName: stringValue(item, "categoryName", ""),
        totalSessions: numberValue(item, "totalSessions"),
        usedSessions: numberValue(item, "usedSessions"),
        remainingSessions: numberValue(item, "remainingSessions"),
        remainingAmount: numberValue(item, "remainingAmount"),
        purchaseDate: stringValue(item, "purchaseDate", ""),
        lastUsedDate: stringValue(item, "lastUsedDate", ""),
        expiryDate: stringValue(item, "expiryDate", ""),
      }))
      .filter((item) => (item.remainingSessions ?? 0) > 0)
      .sort((left, right) => {
        const leftExpiry = left.expiryDate || "9999-12-31";
        const rightExpiry = right.expiryDate || "9999-12-31";
        if (leftExpiry !== rightExpiry) {
          return leftExpiry.localeCompare(rightExpiry);
        }

        const leftUsed = left.lastUsedDate || "";
        const rightUsed = right.lastUsedDate || "";
        if (leftUsed !== rightUsed) {
          return rightUsed.localeCompare(leftUsed);
        }

        return (right.remainingSessions ?? 0) - (left.remainingSessions ?? 0);
      });
  }

  const packageName =
    stringValue(row, "packageOrServiceName", "") ||
    stringValue(row, "lastPackageName", "") ||
    stringValue(row, "lastPackageServiceName", "") ||
    stringValue(row, "lastServiceName", "") ||
    stringValue(row, "lastService", "");
  const remaining =
    numberValue(row, "packageRemainingSessionsTotal") ??
    numberValue(row, "remainingPackageSessions") ??
    numberValue(row, "remainingSessions");

  if (!packageName || packageName === "-" || remaining == null || remaining <= 0) {
    return [];
  }

  return [
    {
      packageName,
      serviceName: stringValue(row, "serviceName", stringValue(row, "lastServiceName", "")),
      totalSessions: numberValue(row, "totalSessions"),
      usedSessions: numberValue(row, "usedSessions"),
      remainingSessions: remaining,
      lastUsedDate: stringValue(row, "lastMatchingUsageDate", stringValue(row, "lastPackageUsageDate", "")),
    },
  ];
}

function formatRemainingPackageLine(detail: TelegramPackageRemainingDetail) {
  const name = detail.packageName || detail.serviceName || "Package balance";
  const remaining = detail.remainingSessions == null ? "-" : detail.remainingSessions.toLocaleString("en-US");
  const total = detail.totalSessions == null ? null : detail.totalSessions.toLocaleString("en-US");
  const used = detail.usedSessions == null ? null : detail.usedSessions.toLocaleString("en-US");
  const sessionText = total
    ? `${remaining}/${total} sessions left`
    : used
      ? `${remaining} sessions left, ${used} used`
      : `${remaining} sessions left`;
  const expiry = detail.expiryDate ? `, expiry ${detail.expiryDate}` : "";
  return `- ${name}: ${sessionText}${expiry}`;
}

function formatBirthdayMonthDay(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return dateKey;
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatBirthdayCustomersConversation(response: GreatTimeAgentChatResponse, viewerContext?: CustomerPhoneViewerContext) {
  const table = response.tables?.find((item) => /birthday customers/i.test(item.title));
  if (response.intent !== "birthday_customers" || !table) {
    return [];
  }

  if (table.rows.length === 0) {
    return ["ဒီကာလအတွင်း birthday customer မတွေ့ပါ။ နောက် 60 ရက် / 90 ရက်နဲ့ ပြန်စစ်နိုင်ပါတယ်။"];
  }

  const topRows = table.rows.slice(0, 10);
  const total = metricValue(response, ["Birthday customers"]) ?? table.rows.length;
  const lines = ["မွေးနေ့ရှိတဲ့ customers:"];

  topRows.forEach((row, index) => {
    const name = stringValue(row, "customerName", "Customer");
    const code = stringValue(row, "customerCode", "");
    const phone = formatCustomerPhone(
      {
        fullPhone: stringValue(row, "phoneNumber", ""),
        maskedPhone: stringValue(row, "customerPhoneMasked", ""),
      },
      viewerContext,
      { logContext: "birthday_customers_phone" },
    );
    const birthday = stringValue(row, "upcomingBirthdayDate", "");
    const age = numberValue(row, "turningAge");
    const lastVisit = stringValue(row, "lastVisitDate", "");
    const lastService = stringValue(row, "lastServiceName", "");
    const packageDetails = packageRemainingDetailsFromRow(row).slice(0, 2);
    const action = stringValue(row, "suggestedAction", "");
    const codeText = code && code !== "-" ? ` (${code})` : "";

    lines.push("", `${index + 1}. ${name}${codeText}`);
    lines.push(`Phone: ${phone && phone !== "-" ? phone : "မရှိသေးပါ"}`);
    lines.push(`Birthday: ${birthday && birthday !== "-" ? formatBirthdayMonthDay(birthday) : "-"}`);
    lines.push(`Age: ${age == null ? "unknown" : age.toLocaleString("en-US")}`);
    lines.push(`Last visit: ${lastVisit && lastVisit !== "-" ? lastVisit : "မရှိသေးပါ"}`);
    if (lastService && lastService !== "-") {
      lines.push(`Last service: ${lastService}`);
    }

    if (packageDetails.length > 0) {
      lines.push("", "Remaining package:");
      packageDetails.forEach((detail) => {
        lines.push(formatRemainingPackageLine(detail));
      });
    }

    if (action && action !== "-") {
      lines.push("", "Action:");
      lines.push(action);
    }
  });

  lines.push("", `Summary:`, `Total birthday customers: ${formatTelegramNumber(total)}`);

  if (table.rows.length > topRows.length) {
    lines.push(`နောက်ထပ် customer ${(table.rows.length - topRows.length).toLocaleString("en-US")} ယောက်ကို CSV export ထဲမှာ ကြည့်နိုင်ပါတယ်။`);
  }

  return lines;
}

function formatCustomerMatchesConversation(response: GreatTimeAgentChatResponse) {
  const table = response.tables?.find((item) => /customer relationship matches/i.test(item.title));
  if (!table?.rows.length) {
    return [];
  }

  const isPackageNeverCame = ["package_bought_never_came", "package_bought_never_used"].includes(response.intent);
  const isPackageNotUsed = response.intent === "package_bought_not_used";
  const lines = [
    isPackageNeverCame
      ? "Package ဝယ်ပြီးနောက် မလာသေးတဲ့ customer များ:"
      : isPackageNotUsed
        ? "Package ဝယ်ထားပြီး အသုံးမပြုသေးတဲ့ customer များ:"
        : "Customer list ကို owner ဖတ်ရလွယ်အောင် ပြထားပါတယ်:",
  ];
  table.rows.slice(0, 8).forEach((row, index) => {
    const name = stringValue(row, "customerName", "Customer");
    const phone = stringValue(row, "customerPhone", stringValue(row, "maskedPhone", stringValue(row, "customerPhoneMasked", "")));
    const lastVisit = stringValue(row, "lastVisitDate", "");
    const packagePurchaseDate = stringValue(row, "lastPackagePurchaseDate", "");
    const packageService = stringValue(row, "lastPackageServiceName", stringValue(row, "lastPackageName", ""));
    const remaining = numberValue(row, "remainingPackageSessions");
    const packageDetails = packageRemainingDetailsFromRow(row);

    if (isPackageNeverCame || isPackageNotUsed) {
      const phoneText = phone && phone !== "-" ? `phone ${phone}၊ ` : "";
      const dateText = packagePurchaseDate && packagePurchaseDate !== "-" ? `${packagePurchaseDate} မှာ ` : "";
      const serviceText = packageService && packageService !== "-" ? `${packageService} ` : "package ";
      const remainingText = remaining != null ? ` လက်ကျန် ${remaining.toLocaleString("en-US")} session ရှိပါတယ်။` : "";
      const statusText = isPackageNeverCame ? "ဝယ်ပြီးနောက် လာသုံးထားတဲ့ visit မတွေ့သေးပါ။" : "အသုံးပြုထားတာ မတွေ့သေးပါ။";
      lines.push(`${index + 1}. ${name} — ${phoneText}${dateText}${serviceText}ဝယ်ထားပါတယ်။ ${statusText}${remainingText}`);
      return;
    }

    const parts = [`${index + 1}. ${name}`];
    if (phone && phone !== "-") {
      parts.push(`phone ${phone}`);
    }
    if (lastVisit && lastVisit !== "-") {
      parts.push(`နောက်ဆုံးလာခဲ့တာ ${lastVisit}`);
    }
    if (packageDetails.length > 0) {
      parts.push(`${packageDetails[0]!.packageName} လက်ကျန် ${(packageDetails[0]!.remainingSessions ?? remaining ?? 0).toLocaleString("en-US")} session`);
    }
    lines.push(`${parts.join(" — ")}။`);
  });

  return lines;
}

function formatTopCustomersByRevenueConversation(response: GreatTimeAgentChatResponse, viewerContext?: CustomerPhoneViewerContext) {
  const table = response.tables?.find((item) => /top customers by revenue/i.test(item.title));
  if (!table?.rows.length) {
    return [];
  }

  const topRows = table.rows.slice(0, 10);
  const totalRevenue = topRows.reduce((sum, row) => sum + (numberValue(row, "totalSpent") ?? 0), 0);
  const periodText = response.period.label === "this month" ? "ဒီလ" : "ဒီကာလ";
  const lines = [`${periodText} spending အများဆုံး customer များ:`];

  topRows.forEach((row, index) => {
    const name = stringValue(row, "customerName", "Customer");
    const phone = formatCustomerPhone(
      {
        fullPhone: stringValue(row, "phoneNumber", ""),
        maskedPhone: stringValue(row, "customerPhoneMasked", ""),
      },
      viewerContext,
      { logContext: "top_customers_by_revenue_phone" },
    );
    const totalSpent = numberValue(row, "totalSpent");
    const visits = numberValue(row, "visitCount");
    const lastVisit = stringValue(row, "lastVisitDate", "");
    const topService = stringValue(row, "topServiceName", "");
    const topPackage = stringValue(row, "topPackageName", "");
    const servicePackage =
      topService && topPackage
        ? `${topService} / ${topPackage}`
        : topService || topPackage;
    const packageDetails = packageRemainingDetailsFromRow(row).slice(0, 2);

    lines.push("", `${index + 1}. ${name}`);
    if (phone && phone !== "-") {
      lines.push(`   Phone: ${phone}`);
    }
    lines.push(`   Total spent: ${totalSpent != null ? formatTelegramMoney(totalSpent) : "-"}`);
    lines.push(`   Visits: ${visits != null ? visits.toLocaleString("en-US") : "0"}`);
    lines.push(`   Last visit: ${lastVisit && lastVisit !== "-" ? lastVisit : "-"}`);
    if (servicePackage && servicePackage !== "-") {
      lines.push(`   Top service/package: ${servicePackage}`);
    }
    if (packageDetails.length > 0) {
      lines.push("   Remaining package:");
      packageDetails.forEach((detail) => {
        lines.push(`   ${formatRemainingPackageLine(detail)}`);
      });
    }
  });

  lines.push("", `Summary: Top ${topRows.length.toLocaleString("en-US")} customers total revenue: ${formatTelegramMoney(totalRevenue)}`);

  if (table.rows.length > topRows.length) {
    lines.push(`နောက်ထပ် customer ${(table.rows.length - topRows.length).toLocaleString("en-US")} ယောက်ကို CSV export ထဲမှာ ကြည့်နိုင်ပါတယ်။`);
  }

  return lines;
}

function formatCustomerPurchaseConversation(response: GreatTimeAgentChatResponse) {
  const purchaseTable = response.tables?.find((item) => /customer recent purchases/i.test(item.title));
  const packageTable = response.tables?.find((item) => /customer packages/i.test(item.title));
  if (!purchaseTable?.rows.length && !packageTable?.rows.length) {
    return [];
  }

  const lines = ["Customer ရဲ့ purchase/service history ကို ဖတ်ရလွယ်အောင် ပြထားပါတယ်:"];

  if (purchaseTable?.rows.length) {
    lines.push("", "ဝယ်ထားတဲ့ service / invoice များ:");
    purchaseTable.rows.slice(0, 10).forEach((row, index) => {
      const date = stringValue(row, "dateLabel", "-");
      const service = stringValue(row, "serviceName", "Service");
      const invoice = stringValue(row, "invoiceNumber", "");
      const method = stringValue(row, "paymentMethod", "");
      const amount = numberValue(row, "netAmount");
      const invoiceText = invoice && invoice !== "-" ? `၊ invoice ${invoice}` : "";
      const methodText = method && method !== "-" ? `၊ ${method}` : "";
      const amountText = amount != null ? `၊ ${amount.toLocaleString("en-US")} ကျပ်` : "";
      lines.push(`${index + 1}. ${date} — ${service}${invoiceText}${methodText}${amountText}`);
    });
  }

  if (packageTable?.rows.length) {
    lines.push("", "Package/session အခြေအနေ:");
    packageTable.rows.slice(0, 8).forEach((row, index) => {
      const service = stringValue(row, "serviceName", "Package service");
      const total = numberValue(row, "totalSessions");
      const used = numberValue(row, "usedSessions");
      const remaining = numberValue(row, "remainingSessions");
      const latestUsage = stringValue(row, "latestUsageDate", "");
      const totalText = total != null ? `${total.toLocaleString("en-US")} session` : "session";
      const usedText = used != null ? `သုံးပြီး ${used.toLocaleString("en-US")}` : "သုံးပြီး -";
      const remainingText = remaining != null ? `ကျန် ${remaining.toLocaleString("en-US")}` : "ကျန် -";
      const latestText = latestUsage && latestUsage !== "-" ? `၊ နောက်ဆုံးသုံးခဲ့တာ ${latestUsage}` : "";
      lines.push(`${index + 1}. ${service} — ${totalText}၊ ${usedText}၊ ${remainingText}${latestText}`);
    });
  }

  return lines;
}

function formatCustomerChoiceConversation(response: GreatTimeAgentChatResponse, viewerContext?: CustomerPhoneViewerContext) {
  const table = response.tables?.find((item) => /possible customer matches|suggested customer matches/i.test(item.title));
  if (!table?.rows.length) {
    return [];
  }

  const isSuggestion = /suggested/i.test(table.title);
  const searchName = response.summary?.match(/named\s+([^".]+)|customers named\s+([^".]+)|find\s+"([^"]+)"/i);
  const query = searchName?.[1] ?? searchName?.[2] ?? searchName?.[3] ?? "customer";
  const lines = [
    isSuggestion
      ? sanitizeOwnerFacingText(response.summary ?? `I couldn’t find "${query}". Please choose the closest match.`)
      : `${query} ဆိုတဲ့ customer ${table.rows.length.toLocaleString("en-US")} ယောက်တွေ့ပါတယ်။ ဘယ်သူကိုကြည့်မလဲ?`,
  ];

  table.rows.slice(0, 10).forEach((row, index) => {
    const ref = response.entityRefs?.find((item) => item.entityType === "customer" && (item.rank === index + 1 || item.customerKey === stringValue(row, "customerKey", "")));
    const name = ref?.customerName ?? ref?.displayName ?? stringValue(row, "customerName", "Customer");
    const phone = formatCustomerPhone(
      {
        fullPhone: ref?.customerPhone,
        maskedPhone: ref?.customerPhoneMasked ?? stringValue(row, "customerPhoneMasked", ""),
      },
      viewerContext,
    );
    const memberId = ref?.memberId ?? stringValue(row, "memberId", "");
    const memberText = memberId && memberId !== "-" ? ` — member ${memberId}` : "";
    lines.push(`${index + 1}. ${name} — ${phone}${memberText}`);
  });

  return lines;
}

function isProtectedNumericColumn(column: GreatTimeAgentTableColumn) {
  if (column.pii === "phone" || column.pii === "id") {
    return true;
  }

  const key = column.key.toLowerCase();
  const title = column.title.toLowerCase();
  const combined = `${key} ${title}`;

  return (
    key === "id" ||
    key.endsWith("id") ||
    /phone|phone\s*number|invoice\s*number|invoicenumber|appointment\s*id|member\s*id|customer\s*id|\bid\b/.test(combined)
  );
}

function isMoneyColumn(column: GreatTimeAgentTableColumn) {
  if (column.unit) {
    return column.unit === "amount";
  }

  const text = `${column.key} ${column.title}`.toLowerCase();
  return (
    text.includes("amount") ||
    text.includes("revenue") ||
    text.includes("sales") ||
    text.includes("collected") ||
    text.includes("payment") ||
    text.includes("invoice value") ||
    text.includes("average invoice") ||
    text.includes("net")
  );
}

function isCountColumn(column: GreatTimeAgentTableColumn) {
  if (column.unit) {
    return column.unit === "count";
  }

  const text = `${column.key} ${column.title}`.toLowerCase();
  return (
    text.includes("count") ||
    text.includes("transactions") ||
    text.includes("invoice") ||
    text.includes("customers") ||
    text.includes("bookings") ||
    text.includes("treatments")
  );
}

function formatTableCellForTelegram(
  row: Record<string, unknown>,
  column: GreatTimeAgentTableColumn,
  viewerContext?: CustomerPhoneViewerContext,
) {
  const raw = row[column.key];
  if (column.pii === "phone") {
    return formatCustomerPhone(
      {
        fullPhone: typeof raw === "string" || typeof raw === "number" ? String(raw) : undefined,
        maskedPhone:
          stringValue(row, `${column.key}Masked`, "") ||
          stringValue(row, "maskedPhone", "") ||
          stringValue(row, "customerPhoneMasked", ""),
      },
      viewerContext,
      { logContext: "generic_table_phone" },
    );
  }
  if (isProtectedNumericColumn(column)) {
    return stringValue(row, column.key);
  }
  if (column.unit === "text") {
    return stringValue(row, column.key);
  }
  if (column.unit === "percent") {
    return isNumericLike(raw) ? `${formatTelegramNumber(raw)}%` : stringValue(row, column.key);
  }
  if (isMoneyColumn(column)) {
    return formatTelegramMoney(raw);
  }
  if (isNumericLike(raw) && isCountColumn(column)) {
    return formatTelegramNumber(raw);
  }

  return stringValue(row, column.key);
}

function formatGenericTableConversation(response: GreatTimeAgentChatResponse, viewerContext?: CustomerPhoneViewerContext) {
  const table = response.tables?.find((item) => item.rows.length > 0);
  if (!table) {
    return [];
  }

  const columns = table.columns.slice(0, 4);
  const lines = [`${table.title} ကို ဖတ်ရလွယ်အောင် ပြထားပါတယ်:`];
  table.rows.slice(0, 6).forEach((row, index) => {
    const values = columns
      .map((column) => `${column.title}: ${formatTableCellForTelegram(row, column, viewerContext)}`)
      .join("၊ ");
    lines.push(`${index + 1}. ${values}။`);
  });

  return lines;
}

function formatConversationTablePreview(
  response: GreatTimeAgentChatResponse,
  options?: { viewerContext?: CustomerPhoneViewerContext; clinicCode?: string },
) {
  if (response.resolvedAgent === "appointment" || response.tables?.some((table) => table.title === "Appointment services")) {
    return formatAppointmentConversation(response, options?.viewerContext, options?.clinicCode);
  }

  const reconciliation = formatOperationsCountReconciliationConversation(response);
  if (reconciliation.length) {
    return reconciliation;
  }

  const financeSales = formatFinanceSalesConversation(response);
  if (financeSales.length) {
    return financeSales;
  }

  const paymentMethodDetail = formatPaymentMethodDetailConversation(response);
  if (paymentMethodDetail.length) {
    return paymentMethodDetail;
  }

  const paymentMethods = formatPaymentMethodsConversation(response);
  if (paymentMethods.length) {
    return paymentMethods;
  }

  const treatmentRoster = formatDailyTreatmentRosterConversation(response, options?.viewerContext);
  if (treatmentRoster.length) {
    return treatmentRoster;
  }

  const practitioner = formatPractitionerPerformanceConversation(response);
  if (practitioner.length) {
    return practitioner;
  }

  const service = formatServicePerformanceConversation(response);
  if (service.length) {
    return service;
  }

  const birthdayCustomers = formatBirthdayCustomersConversation(response, options?.viewerContext);
  if (birthdayCustomers.length) {
    return birthdayCustomers;
  }

  const topCustomersByRevenue = formatTopCustomersByRevenueConversation(response, options?.viewerContext);
  if (topCustomersByRevenue.length) {
    return topCustomersByRevenue;
  }

  const customers = formatCustomerMatchesConversation(response);
  if (customers.length) {
    return customers;
  }

  const customerChoices = formatCustomerChoiceConversation(response, options?.viewerContext);
  if (customerChoices.length) {
    return customerChoices;
  }

  const purchases = formatCustomerPurchaseConversation(response);
  if (purchases.length) {
    return purchases;
  }

  return formatGenericTableConversation(response, options?.viewerContext);
}

function formatCustomer360PackageLine(row: Customer360FactPack["packages"]["holdings"][number]) {
  const remaining = row.remainingSessions ?? 0;
  const total = row.totalSessions ?? 0;
  const latest = row.latestUsageDate ? ` | နောက်ဆုံး ${row.latestUsageDate}` : "";
  const therapist = row.latestTherapist ? ` | ${row.latestTherapist}` : "";

  return `- ${row.serviceName}: ကျန် ${remaining.toLocaleString("en-US")}/${total.toLocaleString("en-US")}${latest}${therapist}`;
}

function formatCustomer360VisitSummary(row: Record<string, unknown>) {
  const date = typeof row.checkInTime === "string" ? row.checkInTime.slice(0, 10) : "-";
  const service = typeof row.serviceName === "string" && row.serviceName ? row.serviceName : "Service";
  const therapist = typeof row.therapistName === "string" && row.therapistName ? row.therapistName : "";
  return [date, service, therapist].filter(Boolean).join(" — ");
}

function customer360LooksNew(factPack: Customer360FactPack) {
  const totalVisits = factPack.value.totalVisits ?? 0;
  const recentCompleted = factPack.appointments.recentCompleted?.length ?? 0;
  const packageCount = factPack.packages.purchaseCount ?? factPack.packages.holdings.length ?? 0;
  const invoiceCount = factPack.payments.invoiceCount ?? factPack.payments.recentInvoices.length ?? 0;

  return totalVisits === 0 && recentCompleted === 0 && packageCount === 0 && invoiceCount === 0;
}

function formatCustomer360HistoryReply(
  factPack: Customer360FactPack,
  viewerContext?: CustomerPhoneViewerContext,
) {
  const lines = [`${factPack.identity.displayName} history`];
  const displayPhone = formatCustomerPhone(
    {
      fullPhone: factPack.identity.phoneNumber,
      maskedPhone: factPack.identity.maskedPhone,
    },
    viewerContext,
    { logContext: "customer_history" },
  );
  if (displayPhone !== "-") {
    lines.push("", `Phone: ${displayPhone}`);
  }

  const recentTreatments = (factPack.appointments.recentCompleted ?? []).slice(0, 8);
  if (recentTreatments.length) {
    lines.push("", "Recent treatments:");
    recentTreatments.forEach((row, index) => {
      lines.push(`${index + 1}. ${formatCustomer360VisitSummary(row)}`);
    });
  } else {
    lines.push("", "No previous visit found yet.");
  }

  const topService = factPack.usage.topServices[0];
  if (topService) {
    const service = stringValue(topService, "serviceName", "Service");
    const usage = numberValue(topService, "totalUsage");
    lines.push("", "Most used service:");
    lines.push(`${service}${usage != null ? ` — ${usage.toLocaleString("en-US")} times` : ""}`);
  }

  if (factPack.packages.holdings.length) {
    lines.push("", "Package / balance:");
    factPack.packages.holdings.slice(0, 5).forEach((row) => {
      lines.push(formatCustomer360PackageLine(row));
    });
  }

  const message = lines.join("\n").trim();
  return message.length <= 3900 ? message : `${message.slice(0, 3890).trim()}\n...`;
}

function formatCustomer360TelegramReply(response: GreatTimeAgentChatResponse, viewerContext?: CustomerPhoneViewerContext) {
  const factPack = response.customer360;
  if (!factPack) {
    return "";
  }

  const packageRows = factPack.packages.holdings.filter((row) => (row.remainingSessions ?? 0) > 0).slice(0, 6);
  const recentTreatments = (factPack.appointments.recentCompleted ?? []).slice(0, 3);
  const topServices = factPack.usage.topServices.slice(0, 3);
  if (isCustomerHistoryResponse(response)) {
    return formatCustomer360HistoryReply(factPack, viewerContext);
  }

  const lines = [factPack.identity.displayName];
  const displayPhone = formatCustomerPhone(
    {
      fullPhone: factPack.identity.phoneNumber,
      maskedPhone: factPack.identity.maskedPhone,
    },
    viewerContext,
    { logContext: "customer_card" },
  );

  if (displayPhone !== "-") {
    lines.push("", `Phone: ${displayPhone}`);
  }
  if (factPack.identity.memberId) {
    lines.push(`Member ID: ${factPack.identity.memberId}`);
  }

  const todayAppointment = factPack.appointments.current?.[0];
  if (todayAppointment) {
    const service = stringValue(todayAppointment, "serviceName", "-");
    const staff = stringValue(todayAppointment, "staffName", stringValue(todayAppointment, "practitionerName", "-"));
    const time = stringValue(todayAppointment, "appointmentTime", "-");
    const phone = formatCustomerPhone(
      {
        fullPhone: stringValue(todayAppointment, "phoneNumber", factPack.identity.phoneNumber ?? ""),
        maskedPhone: stringValue(todayAppointment, "phoneMasked", factPack.identity.maskedPhone ?? ""),
      },
      viewerContext,
      { logContext: "customer_card_today_appointment" },
    );
    const status = stringValue(todayAppointment, "appointmentStatus", "-");

    lines.push("", `Today appointment: ${time}`);
    lines.push(`Service: ${service}`);
    lines.push(`Staff: ${staff}`);
    lines.push(`Status: ${status}`);
    if (phone !== "-" && phone !== displayPhone) {
      lines.push(`Phone: ${phone}`);
    }
  }

  if (recentTreatments.length > 0) {
    lines.push("", "Last visit:");
    lines.push(formatCustomer360VisitSummary(recentTreatments[0]!));
  } else if (customer360LooksNew(factPack)) {
    lines.push("", "This customer looks new.");
    lines.push("No previous history found yet.");
  }

  if ((factPack.value.totalVisits ?? 0) > 0 || recentTreatments.length > 0) {
    lines.push(`Total visits: ${(factPack.value.totalVisits ?? recentTreatments.length).toLocaleString("en-US")}`);
  }

  const topService = topServices[0];
  if (topService) {
    const service = typeof topService.serviceName === "string" ? topService.serviceName : "Service";
    const usage = typeof topService.totalUsage === "number" ? ` — ${topService.totalUsage.toLocaleString("en-US")} times` : "";
    lines.push(`Most used service: ${service}${usage}`);
  }

  if (packageRows.length > 0) {
    lines.push("", "Package / balance:");
    packageRows.forEach((row) => {
      lines.push(formatCustomer360PackageLine(row));
    });
  }

  if (factPack.recommendation && !customer360LooksNew(factPack)) {
    lines.push("", `အကြံပြုချက်: ${sanitizeOwnerFacingText(factPack.recommendation.title)}`);
    factPack.recommendation.evidence.slice(0, 2).forEach((item) => {
      lines.push(`- ${sanitizeOwnerFacingText(item)}`);
    });
  }

  const message = lines.join("\n").trim();
  return message.length <= 3900 ? message : `${message.slice(0, 3890).trim()}\n...`;
}

export function formatAgentHubTelegramReply(
  response: GreatTimeAgentChatResponse,
  options?: { viewerContext?: CustomerPhoneViewerContext; clinicCode?: string },
) {
  if (response.customer360) {
    return formatCustomer360TelegramReply(response, options?.viewerContext);
  }

  const tablePreview = formatConversationTablePreview(response, options);
  const lines = [...buildTelegramReplyHeader(response)];
  const metrics = (response.metrics ?? []).slice(0, 5);
  const warnings = (response.warnings ?? []).slice(0, 2);

  if (tablePreview.length > 0) {
    lines.push("", ...tablePreview);
  } else {
    lines.push("", sanitizeOwnerFacingText(response.summary || response.assistantMessage));
  }

  if (
    metrics.length > 0 &&
    response.resolvedAgent !== "appointment" &&
    response.intent !== "operations_count_reconciliation" &&
    response.intent !== "top_customers_by_revenue" &&
    response.intent !== "payment_method_breakdown" &&
    response.intent !== "payment_method_detail" &&
    !isFinanceSalesSummaryResponse(response)
  ) {
    lines.push("", "အဓိကကိန်းဂဏန်းများ:");
    metrics.forEach((metric) => {
      lines.push(`- ${translateMetricLabel(metric.label)}: ${formatMetricValue(metric.value, metric.unit)}`);
    });
  }

  if (warnings.length > 0) {
    lines.push("", "သတိပြုရန်:");
    warnings.forEach((warning) => {
      lines.push(`- ${sanitizeOwnerFacingText(warning.title)}: ${sanitizeOwnerFacingText(warning.message)}`);
    });
  }

  const message = lines.join("\n").trim();
  return message.length <= 3900 ? message : `${message.slice(0, 3890).trim()}\n...`;
}

function cleanupSuggestedQuestionCallbacks() {
  const cutoff = Date.now() - SUGGESTED_QUESTION_TTL_MS;
  suggestedQuestionCallbacks.forEach((value, key) => {
    if (value.createdAt < cutoff) {
      suggestedQuestionCallbacks.delete(key);
    }
  });
}

function suggestionCategory(question: string) {
  const normalized = question.toLowerCase();
  if (/recent completed treatments?|completed treatments?/.test(normalized)) {
    return "recent_treatments";
  }
  if (/full customer profile|customer profile/.test(normalized)) {
    return "customer_profile";
  }
  if (/package balance|package/.test(normalized) && /customer|first|this|that|her|him/.test(normalized)) {
    return "customer_package_balance";
  }
  if (/treatment history|last treatment|treatments?/.test(normalized) && /customer|first|this|that|her|him/.test(normalized)) {
    return "customer_treatment_history";
  }
  if (/cancel|no[- ]?show|မလာ|ဖျက်/.test(normalized)) {
    return "appointment_cancelled_no_show";
  }
  if (/arrived\s+but\s+not\s+started|checked\s+in\s+but\s+not\s+started|treatment\s+not\s+started|process\s+not\s+started|ရောက်ပြီး[\s\S]{0,40}(?:treatment|process)?\s*မစ|ကုသမှု\s*မစ|မစသေး/.test(normalized)) {
    return "appointment_arrived_not_started";
  }
  if (/not\s+(?:checked\s*out|completed|finished|done)|haven['’]?t\s+checked\s*out|hasn['’]?t\s+checked\s*out|no\s+checkout\s+yet|မပြီး|မလုပ်သေး|checkout\s*မလုပ်|check-out\s*မလုပ်/.test(normalized)) {
    return "appointment_not_checked_out";
  }
  if (/checked[- ]?in|check[- ]?in|arrived|ရောက်/.test(normalized)) {
    return "appointment_checked_in";
  }
  if (/checked[- ]?out|check[- ]?out|ပြီးဆုံး/.test(normalized) || (/completed/.test(normalized) && /appointment|booking|customer/.test(normalized))) {
    return "appointment_checked_out";
  }
  if (/tomorrow|မနက်ဖြန်/.test(normalized) && /appointment|booking|ချိန်း/.test(normalized)) {
    return "appointment_tomorrow";
  }
  if (/trend|weekly|this week|ဒီအပတ်/.test(normalized) && /appointment|booking|ချိန်း/.test(normalized)) {
    return "appointment_trend";
  }
  if (/appointment|appointments|booking|bookings|ချိန်း/.test(normalized) && /today|scheduled|all|list|how many|ဒီနေ့/.test(normalized)) {
    return "appointment_today";
  }
  if (/payment method/i.test(question)) {
    return "payment_method";
  }
  if (/service.*declining|declining.*service/i.test(question)) {
    return "declining_service";
  }
  if (/top services/i.test(question)) {
    return "top_services";
  }
  if (/practitioner|therapist/i.test(question)) {
    return "practitioner";
  }
  if (/customer/i.test(question)) {
    return "customer_detail";
  }

  return normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "suggestion";
}

function isRedundantSuggestion(response: GreatTimeAgentChatResponse, category: string) {
  if (response.resolvedAgent !== "appointment") {
    return false;
  }

  if (["appointment_summary", "appointment_list"].includes(response.intent)) {
    return category === "appointment_today";
  }
  if (response.intent === "checked_in_customers") {
    return category === "appointment_checked_in";
  }
  if (response.intent === "checked_out_customers") {
    return category === "appointment_checked_out";
  }
  if (response.intent === "not_checked_out_customers") {
    return category === "appointment_not_checked_out";
  }
  if (response.intent === "arrived_not_started_customers") {
    return category === "appointment_arrived_not_started";
  }
  if (response.intent === "cancelled_no_show") {
    return category === "appointment_cancelled_no_show";
  }
  if (response.intent === "appointment_trend") {
    return category === "appointment_trend";
  }

  return false;
}

function suggestionLabel(question: string, index: number) {
  const normalized = question.toLowerCase();
  if (/recent completed treatments?|completed treatments?/.test(normalized)) {
    return "နောက်ဆုံး treatment ကြည့်မယ်";
  }
  if (/full customer profile|customer profile/.test(normalized)) {
    return "Customer profile ကြည့်မယ်";
  }
  if (/package balance|package/.test(normalized) && /customer|first|this|that|her|him/.test(normalized)) {
    return "Package လက်ကျန် ကြည့်မယ်";
  }
  if (/treatment history|last treatment|treatments?/.test(normalized) && /customer|first|this|that|her|him/.test(normalized)) {
    return "Treatment history ကြည့်မယ်";
  }
  if (/cancel|no[- ]?show|မလာ|ဖျက်/.test(normalized)) {
    return "ဖျက်/မလာ ကြည့်မယ်";
  }
  if (/arrived\s+but\s+not\s+started|checked\s+in\s+but\s+not\s+started|treatment\s+not\s+started|process\s+not\s+started|ရောက်ပြီး[\s\S]{0,40}(?:treatment|process)?\s*မစ|ကုသမှု\s*မစ|မစသေး/.test(normalized)) {
    return "ရောက်ပြီး treatment မစသေးသူ ကြည့်မယ်";
  }
  if (/not\s+(?:checked\s*out|completed|finished|done)|haven['’]?t\s+checked\s*out|hasn['’]?t\s+checked\s*out|no\s+checkout\s+yet|မပြီး|မလုပ်သေး|checkout\s*မလုပ်|check-out\s*မလုပ်/.test(normalized)) {
    return "Checkout မလုပ်သေးသူ ကြည့်မယ်";
  }
  if (/checked[- ]?in|check[- ]?in|arrived|ရောက်/.test(normalized)) {
    return "ရောက်ရှိပြီးသူ ကြည့်မယ်";
  }
  if (/checked[- ]?out|check[- ]?out|ပြီးဆုံး/.test(normalized) || (/completed/.test(normalized) && /appointment|booking|customer/.test(normalized))) {
    return "ပြီးဆုံးသူ ကြည့်မယ်";
  }
  if (/tomorrow|မနက်ဖြန်/.test(normalized) && /appointment|booking|ချိန်း/.test(normalized)) {
    return "မနက်ဖြန် appointment";
  }
  if (/trend|weekly|this week|ဒီအပတ်/.test(normalized) && /appointment|booking|ချိန်း/.test(normalized)) {
    return "Appointment trend";
  }
  if (/appointment|booking|ချိန်း/.test(normalized) && /today|scheduled|all|list|how many|ဒီနေ့/.test(normalized)) {
    return "ဒီနေ့စာရင်း ကြည့်မယ်";
  }
  if (/payment method/i.test(normalized)) {
    return "Payment method အလိုက်ကြည့်မယ်";
  }
  if (/service.*declining|declining.*service/i.test(normalized)) {
    return "ကျနေတဲ့ service ကြည့်မယ်";
  }
  if (/practitioner|therapist/i.test(normalized)) {
    return "Practitioner performance ကြည့်မယ်";
  }
  if (/top services/i.test(normalized)) {
    return "Top services ကြည့်မယ်";
  }
  if (/customer/i.test(normalized)) {
    return "Customer detail ကြည့်မယ်";
  }

  return `Action ${index + 1}`;
}

function registerSuggestedQuestion(question: string) {
  cleanupSuggestedQuestionCallbacks();
  const key = createHash("sha256")
    .update(`${Date.now()}|${Math.random()}|${question}`)
    .digest("hex")
    .slice(0, 16);
  suggestedQuestionCallbacks.set(key, {
    question,
    createdAt: Date.now(),
  });

  return key;
}

function newCallbackToken(prefix: string) {
  return createHash("sha256")
    .update(`${prefix}|${Date.now()}|${Math.random()}`)
    .digest("hex")
    .slice(0, 12);
}

function hashTelegramIdentifier(value?: string | null) {
  if (!value) {
    return null;
  }

  return createHash("sha256").update(`telegram:${value}`).digest("hex").slice(0, 32);
}

function telegramCallbackDataType(value?: string | null) {
  return value?.split(":")[0]?.slice(0, 64) || null;
}

function countInlineKeyboardButtons(replyMarkup?: Record<string, unknown>) {
  const keyboard = replyMarkup?.inline_keyboard;
  if (!Array.isArray(keyboard)) {
    return 0;
  }

  return keyboard.reduce((sum, row) => (Array.isArray(row) ? sum + row.length : sum), 0);
}

async function recordTelegramCallbackIssue(params: {
  callback: TelegramCallbackQuery;
  chatId?: string | null;
  target?: TelegramTargetStatus | null;
  errorCategory:
    | "telegram_callback_expired"
    | "appointment_context_missing"
    | "callback_data_invalid"
    | "csv_export_failed";
  currentStep: string;
  callbackExpired?: boolean;
  callbackResolved?: boolean;
  sanitizedError?: string;
}) {
  const createdAt = nowIso();
  const callbackHash = createHash("sha256")
    .update(`telegram-callback:${params.callback.id}:${createdAt}`)
    .digest("hex")
    .slice(0, 16);
  const runId = `tgcb_${callbackHash}`;
  const chatId = params.chatId ?? (params.callback.message?.chat?.id == null ? null : String(params.callback.message.chat.id));
  const userId = params.callback.from?.id == null ? null : String(params.callback.from.id);

  await saveAgentRunTrace({
    runId,
    clinicId: params.target?.clinicId ?? "unknown",
    clinicCode: params.target?.clinicCode ?? null,
    clinicName: null,
    userId: `telegram:${hashTelegramIdentifier(userId) ?? "unknown"}`,
    userEmail: null,
    sessionId: `telegram_callback_${callbackHash}`,
    requestId: runId,
    responseId: runId,
    status: "failed",
    currentStep: params.currentStep,
    channel: "telegram",
    telegramChatIdHash: hashTelegramIdentifier(chatId),
    telegramUserIdHash: hashTelegramIdentifier(userId),
    telegramMessageId: params.callback.message?.message_id == null ? null : String(params.callback.message.message_id),
    telegramCallbackDataType: telegramCallbackDataType(params.callback.data),
    callbackExpired: params.callbackExpired ?? false,
    callbackResolved: params.callbackResolved ?? false,
    errorCategory: params.errorCategory,
    sanitizedError: params.sanitizedError ?? params.currentStep,
    createdAt,
    updatedAt: createdAt,
    completedAt: createdAt,
    timeline: [
      {
        label: "Telegram callback",
        status: "failed",
        at: createdAt,
        detail: params.currentStep,
      },
    ],
  }).catch((error) => {
    console.warn("[telegram] failed to record callback issue trace", error);
  });
}

function cleanupAppointmentActionCallbacks(now = Date.now()) {
  appointmentActionCallbacks.forEach((value, key) => {
    if (value.expiresAt <= now) {
      appointmentActionCallbacks.delete(key);
    }
  });
}

function registerAppointmentActionToken(params: Omit<AppointmentCallbackToken, "createdAt" | "expiresAt">) {
  cleanupAppointmentActionCallbacks();
  const createdAt = Date.now();
  const key = newCallbackToken("appt");
  appointmentActionCallbacks.set(key, {
    ...params,
    createdAt,
    expiresAt: createdAt + APPOINTMENT_ACTION_TTL_MS,
  });
  return key;
}

function getAppointmentActionToken(key: string, now = Date.now()) {
  cleanupAppointmentActionCallbacks(now);
  const token = appointmentActionCallbacks.get(key);
  if (!token || token.expiresAt <= now) {
    appointmentActionCallbacks.delete(key);
    return null;
  }

  return token;
}

function cleanupCustomerActionCallbacks() {
  const cutoff = Date.now() - CUSTOMER_ACTION_TTL_MS;
  customerActionCallbacks.forEach((value, key) => {
    if (value.createdAt < cutoff) {
      customerActionCallbacks.delete(key);
    }
  });
}

function registerCustomerActionRef(entityContext: GreatTimeAgentEntityContext) {
  cleanupCustomerActionCallbacks();
  if (!entityContext.customerKey && !entityContext.entityId) {
    return "";
  }

  const key = newCallbackToken("cust");
  customerActionCallbacks.set(key, {
    entityContext,
    createdAt: Date.now(),
  });

  return key;
}

function getCustomerActionRef(key: string) {
  cleanupCustomerActionCallbacks();
  const cached = customerActionCallbacks.get(key);
  if (cached) {
    return cached;
  }

  for (const value of customerActionCallbacks.values()) {
    if (value.entityContext.customerKey === key || value.entityContext.entityId === key) {
      return value;
    }
  }

  return null;
}

function compactAppointmentButtonTime(value: string) {
  const match = value.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (!match) {
    return value.trim() || "-";
  }

  return `${match[1]!.padStart(2, "0")}:${match[2]}`;
}

function truncateButtonText(value: string, maxLength = 48) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) {
    return clean;
  }

  return `${clean.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function phoneSuffix(value: string | undefined, digits = env.APPOINTMENT_BUTTON_PHONE_SUFFIX_DIGITS) {
  const phoneDigits = (value ?? "").replace(/\D/g, "");
  return phoneDigits.length > 0 ? phoneDigits.slice(-digits) : "";
}

function appointmentDuplicateNameCounts(items: RecentAppointmentContextItem[]) {
  const counts = new Map<string, number>();
  items.forEach((item) => {
    const key = item.customerName.trim().toLowerCase();
    if (key) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  });
  return counts;
}

function appointmentButtonLabel(item: RecentAppointmentContextItem, duplicateNameCounts: Map<string, number>) {
  const time = compactAppointmentButtonTime(item.appointmentTime);
  const name = item.customerName || "Customer";
  const isDuplicate = (duplicateNameCounts.get(name.trim().toLowerCase()) ?? 0) > 1;
  const suffix = isDuplicate ? phoneSuffix(item.resolutionPhone ?? item.fullPhone ?? item.maskedPhone) : "";
  const disambiguator = suffix ? ` · ${suffix}` : "";

  return truncateButtonText(`${time} ${name}${disambiguator}`);
}

function appointmentPageSize() {
  return Math.max(1, env.MAX_APPOINTMENT_BUTTONS_PER_PAGE);
}

function appointmentPageBounds(total: number, page: number) {
  const pageSize = appointmentPageSize();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const start = safePage * pageSize;
  const end = Math.min(total, start + pageSize);
  return { pageSize, totalPages, page: safePage, start, end };
}

function registerAppointmentPageToken(params: {
  clinicId?: string;
  telegramChatId?: string;
  telegramUserId?: string | null;
  page: number;
}) {
  return registerAppointmentActionToken({
    action: "page",
    clinicId: params.clinicId,
    telegramChatId: params.telegramChatId,
    telegramUserId: params.telegramUserId,
    page: params.page,
  });
}

function buildAppointmentSelectionReplyMarkup(params: {
  appointments: RecentAppointmentContextItem[];
  clinicId?: string;
  telegramChatId?: string;
  telegramUserId?: string | null;
  page?: number;
  exportCallbackData?: string;
  includeBackToToday?: boolean;
}) {
  if (params.appointments.length === 0 && !params.exportCallbackData) {
    return undefined;
  }

  const bounds = appointmentPageBounds(params.appointments.length, params.page ?? 0);
  const pageItems = params.appointments.slice(bounds.start, bounds.end);
  const duplicateNameCounts = appointmentDuplicateNameCounts(params.appointments);
  const appointmentButtons = pageItems.map((item) => {
    const token = registerAppointmentActionToken({
      action: "select",
      clinicId: params.clinicId,
      telegramChatId: params.telegramChatId,
      telegramUserId: params.telegramUserId,
      appointmentId: item.appointmentId,
      customerId: item.customerId,
      page: bounds.page,
    });

    return [
      {
        text: appointmentButtonLabel(item, duplicateNameCounts),
        callback_data: `apptsel:${token}`,
      },
    ];
  });

  const navButtons: Array<{ text: string; callback_data: string }> = [];
  if (bounds.page > 0) {
    navButtons.push({
      text: "Previous",
      callback_data: `apptpg:${registerAppointmentPageToken({ ...params, page: bounds.page - 1 })}`,
    });
  }
  if (bounds.end < params.appointments.length) {
    navButtons.push({
      text: "Next",
      callback_data: `apptpg:${registerAppointmentPageToken({ ...params, page: bounds.page + 1 })}`,
    });
  }
  if (params.includeBackToToday && bounds.page !== 0) {
    navButtons.push({
      text: "Back to Today",
      callback_data: `apptpg:${registerAppointmentPageToken({ ...params, page: 0 })}`,
    });
  }

  const keyboard = [
    ...appointmentButtons,
    ...(navButtons.length ? [navButtons] : []),
    ...(params.exportCallbackData
      ? [
          [
            {
              text: "Download CSV",
              callback_data: params.exportCallbackData,
            },
          ],
        ]
      : []),
  ];

  return keyboard.length > 0 ? { inline_keyboard: keyboard } : undefined;
}

function buildAppointmentPageMessage(params: {
  context: RecentAppointmentContext;
  page: number;
  viewerContext: CustomerPhoneViewerContext;
}) {
  const bounds = appointmentPageBounds(params.context.appointments.length, params.page);
  const lines = [
    `Showing ${bounds.start + 1}-${bounds.end} of ${params.context.appointments.length.toLocaleString("en-US")} appointments`,
    "",
  ];

  params.context.appointments.slice(bounds.start, bounds.end).forEach((item) => {
    const phone = formatCustomerPhone(
      { fullPhone: item.fullPhone, maskedPhone: item.maskedPhone },
      params.viewerContext,
      { logContext: "appointment_page" },
    );
    lines.push(`${item.displayIndex}. ${item.appointmentTime} — ${item.customerName}`);
    lines.push(`Phone: ${phone}`);
    lines.push(`Service: ${item.serviceName}`);
    lines.push(`Staff: ${item.staffName || "-"}`);
    lines.push(`Status: ${item.appointmentStatus}`);
    lines.push("");
  });

  lines.push("Customer တစ်ယောက်ကိုရွေးပါ။");
  return lines.join("\n").trim();
}

function findAppointmentContextForCustomer(
  context: RecentAppointmentContext | null | undefined,
  response: GreatTimeAgentChatResponse,
) {
  if (!context?.appointments.length) {
    return null;
  }

  const customerKey = response.customer360?.identity.customerKey ?? response.entityContext?.customerKey ?? response.entityContext?.entityId;
  const appointmentId = response.entityContext?.appointmentId;
  return (
    context.appointments.find((item) => appointmentId && item.appointmentId === appointmentId) ??
    context.appointments.find((item) => customerKey && item.customerId === customerKey) ??
    null
  );
}

function customerEntityContextFromResponse(response: GreatTimeAgentChatResponse) {
  if (response.entityContext?.entityType === "customer") {
    return response.entityContext;
  }

  return response.entityRefs?.find((ref) => ref.entityType === "customer");
}

function isCustomerHistoryResponse(response: GreatTimeAgentChatResponse) {
  return response.intent === "customer_purchase_history";
}

function buildCustomerCardReplyMarkup(params: {
  response: GreatTimeAgentChatResponse;
  recentAppointmentContext?: RecentAppointmentContext | null;
  clinicId?: string;
  telegramChatId?: string;
  telegramUserId?: string | null;
}) {
  if (!params.response.customer360) {
    return undefined;
  }

  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  const entityContext = customerEntityContextFromResponse(params.response);
  const selectedAppointment = findAppointmentContextForCustomer(params.recentAppointmentContext, params.response);
  const actionContext = selectedAppointment ? appointmentContextItemToCustomerEntityContext(selectedAppointment) : entityContext;
  const customerToken = actionContext ? registerCustomerActionRef(actionContext) : "";
  const isHistory = isCustomerHistoryResponse(params.response);

  if (customerToken) {
    if (isHistory) {
      rows.push([{ text: "Back to Customer", callback_data: `customer_details:${customerToken}` }]);
    } else if (!customer360LooksNew(params.response.customer360)) {
      rows.push([{ text: "Full History", callback_data: `customer_history:${customerToken}` }]);
      const hasPackageBalance =
        (params.response.customer360.packages.holdings?.length ?? 0) > 0 ||
        (params.response.customer360.packages.totalRemainingSessions ?? 0) > 0;
      if (hasPackageBalance) {
        rows.push([{ text: "Package / Balance", callback_data: `customer_package:${customerToken}` }]);
      }
    }
  }

  if (params.recentAppointmentContext?.appointments.length) {
    rows.push([
      {
        text: "Back to Today Appointments",
        callback_data: `apptpg:${registerAppointmentPageToken({
          clinicId: params.clinicId,
          telegramChatId: params.telegramChatId,
          telegramUserId: params.telegramUserId,
          page: selectedAppointment
            ? appointmentPageBounds(params.recentAppointmentContext.appointments.length, Math.floor((selectedAppointment.displayIndex - 1) / appointmentPageSize())).page
            : 0,
        })}`,
      },
    ]);
  }

  return rows.length > 0 ? { inline_keyboard: rows } : undefined;
}

export function buildAgentHubTelegramReplyMarkup(
  response: GreatTimeAgentChatResponse,
  options?: {
    exportCallbackData?: string;
    appointmentContextItems?: RecentAppointmentContextItem[];
    recentAppointmentContext?: RecentAppointmentContext | null;
    clinicId?: string;
    telegramChatId?: string;
    telegramUserId?: string | null;
    appointmentPage?: number;
  },
) {
  const appointmentRows = options?.appointmentContextItems ?? [];
  const appointmentMarkup = appointmentRows.length
    ? buildAppointmentSelectionReplyMarkup({
        appointments: appointmentRows,
        clinicId: options?.clinicId,
        telegramChatId: options?.telegramChatId,
        telegramUserId: options?.telegramUserId,
        page: options?.appointmentPage ?? 0,
        exportCallbackData: options?.exportCallbackData,
      })
    : undefined;
  if (appointmentMarkup) {
    return appointmentMarkup;
  }

  const customerCardMarkup = buildCustomerCardReplyMarkup({
    response,
    recentAppointmentContext: options?.recentAppointmentContext,
    clinicId: options?.clinicId,
    telegramChatId: options?.telegramChatId,
    telegramUserId: options?.telegramUserId,
  });
  if (customerCardMarkup) {
    return customerCardMarkup;
  }

  const shouldShowCustomerChoices = response.tables?.some((table) => /possible customer matches|suggested customer matches/i.test(table.title)) ?? false;
  const customerChoiceButtons =
    shouldShowCustomerChoices
        ? (response.entityRefs ?? [])
          .filter((ref) => ref.entityType === "customer")
          .slice(0, 10)
          .map((ref, index) => {
            const key = registerCustomerActionRef(ref);
            return key
              ? [
                  {
                    text: `Open ${ref.rank ?? index + 1}`,
                    callback_data: `customer_details:${key}`,
                  },
                ]
              : [];
          })
          .filter((row) => row.length > 0)
        : [];

  if (customerChoiceButtons.length === 0 && !options?.exportCallbackData) {
    return undefined;
  }

  return {
    inline_keyboard: [
      ...customerChoiceButtons,
      ...(options?.exportCallbackData
        ? [
            [
              {
                text: "Download CSV",
                callback_data: options.exportCallbackData,
              },
            ],
          ]
        : []),
    ],
  };
}

function sanitizeSessionPart(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "unknown";
}

async function buildAgentHubReply(params: {
  target: TelegramTargetStatus;
  question: string;
  telegramChatId: string;
  telegramUserId: string | null;
  telegramMessageId?: string | null;
  telegramCallbackDataType?: string | null;
  entityContext?: GreatTimeAgentEntityContext;
  agent?: GreatTimeAgentId | "auto";
  fromDate?: string;
  toDate?: string;
}) {
  const premium = await hasFeatureAccess({
    clinicId: params.target.clinicId,
    feature: GT_GROWTH_AI_FEATURE_GATE,
  });
  const sessionActor = params.telegramUserId ?? params.target.telegramChatId ?? "chat";
  const sessionId = [
    "telegram",
    sanitizeSessionPart(params.target.clinicId),
    sanitizeSessionPart(params.target.telegramChatId ?? "chat"),
    sanitizeSessionPart(sessionActor),
  ].join("_");
  const request = {
    clinicId: params.target.clinicId,
    clinicCode: params.target.clinicCode,
    sessionId,
    agent: params.agent ?? ("auto" as const),
    message: params.question,
    aiLanguage: params.target.ownerAiLanguage,
    timezone: params.target.timezone,
    fromDate: params.fromDate,
    toDate: params.toDate,
    entityContext: params.entityContext,
  };

  if (!premium.enabled) {
    const response = buildLockedAgentHubResponse({ request, premium });
    const createdAt = nowIso();
    await saveAgentRunTrace({
      runId: response.requestId,
      clinicId: params.target.clinicId,
      clinicCode: params.target.clinicCode,
      clinicName: null,
      userId: `telegram:${sessionActor}`,
      userEmail: null,
      sessionId,
      requestId: response.requestId,
      responseId: response.responseId,
      status: "completed",
      currentStep: "Feature locked response",
      channel: "telegram",
      telegramChatIdHash: hashTelegramIdentifier(params.telegramChatId),
      telegramUserIdHash: hashTelegramIdentifier(params.telegramUserId),
      telegramMessageId: params.telegramMessageId ?? null,
      telegramCallbackDataType: params.telegramCallbackDataType ?? null,
      questionPreview: redactMonitoringText(params.question, 500),
      answerPreview: redactMonitoringText(response.assistantMessage, 500),
      requestedAgent: response.requestedAgent,
      resolvedAgent: response.resolvedAgent,
      intent: response.intent,
      toolNames: [],
      sourceStatuses: response.sources.map((source) => source.dataStatus),
      dataStatus: response.dataStatus,
      fallbackUsed: true,
      deterministicResponseUsed: true,
      totalLatencyMs: 0,
      createdAt,
      updatedAt: createdAt,
      completedAt: createdAt,
      timeline: [
        {
          label: "Feature locked response",
          status: "completed",
          at: createdAt,
        },
      ],
    }).catch((error) => {
      console.warn("[telegram] failed to write locked AI trace", error);
    });
    return response;
  }

  return askAgentHub({
    request,
    clinic: {
      clinicId: params.target.clinicId,
      clinicCode: params.target.clinicCode,
    },
    requestContext: {
      userId: `telegram:${sessionActor}`,
      userEmail: undefined,
      channel: "telegram",
      telegramChatIdHash: hashTelegramIdentifier(params.telegramChatId),
      telegramUserIdHash: hashTelegramIdentifier(params.telegramUserId),
      telegramMessageId: params.telegramMessageId ?? null,
      telegramCallbackDataType: params.telegramCallbackDataType ?? null,
    },
  });
}

function hasExportableAgentTables(response: GreatTimeAgentChatResponse) {
  return response.tables?.some((table) => table.rows.length > 0) ?? false;
}

function buildAppointmentContextSuggestionMessage(params: {
  query: string;
  item: RecentAppointmentContextItem;
  viewerContext: CustomerPhoneViewerContext;
}) {
  const phone = formatCustomerPhone(
    { fullPhone: params.item.fullPhone, maskedPhone: params.item.maskedPhone },
    params.viewerContext,
    { logContext: "appointment_context_suggestion" },
  );
  return [
    `I couldn’t find "${params.query}". Did you mean ${params.item.customerName} from today’s appointment?`,
    "",
    `${params.item.customerName}`,
    `Phone: ${phone}`,
    `Service: ${params.item.serviceName}`,
    `Time: ${params.item.appointmentTime}`,
  ].join("\n");
}

function buildAppointmentContextChoiceMessage(params: {
  query: string;
  items: RecentAppointmentContextItem[];
  viewerContext: CustomerPhoneViewerContext;
}) {
  const lines = [`${params.query} ဆိုတဲ့ customer ${params.items.length.toLocaleString("en-US")} ယောက်တွေ့ပါတယ်။ ဘယ်သူကိုကြည့်မလဲ?`];
  params.items.forEach((item, index) => {
    const phone = formatCustomerPhone(
      { fullPhone: item.fullPhone, maskedPhone: item.maskedPhone },
      params.viewerContext,
      { logContext: "appointment_context_choice" },
    );
    lines.push(`${index + 1}. ${item.customerName} — ${phone} — ${item.serviceName} ${item.appointmentTime}`);
  });
  return lines.join("\n");
}

function appointmentContextReplyMarkup(params: {
  items: RecentAppointmentContextItem[];
  clinicId?: string;
  telegramChatId?: string;
  telegramUserId?: string | null;
}) {
  return buildAppointmentSelectionReplyMarkup({
    appointments: params.items,
    clinicId: params.clinicId,
    telegramChatId: params.telegramChatId,
    telegramUserId: params.telegramUserId,
  });
}

async function handleAgentQuestion(params: {
  chatId: string;
  chatType: TelegramChat["type"];
  question: string;
  telegramUserId: string | null;
  telegramMessageId?: string | null;
  telegramCallbackDataType?: string | null;
  entityContext?: GreatTimeAgentEntityContext;
  agent?: GreatTimeAgentId | "auto";
}) {
  const target = await getTelegramTargetByChatId(params.chatId);

  if (!target) {
    await sendTelegramMessage(
      params.chatId,
      "This Telegram chat is not linked to a GreatTime clinic yet. Link it from GreatTime Settings > Telegram first.",
    );
    return;
  }

  if (!canTelegramUserChatWithAgent({ target, telegramUserId: params.telegramUserId })) {
    await sendTelegramMessage(
      params.chatId,
      target.isAgentChatEnabled
        ? "You are not allowed to chat with GT Brain from this Telegram target. Scheduled reports can still be delivered here."
        : "This Telegram target is report-only. Enable Agent chat for this target in GreatTime Settings > Telegram.",
    );
    return;
  }

  if (!params.question.trim()) {
    await sendTelegramMessage(params.chatId, "Send /ask followed by a clinic question, for example: /ask How much did we collect today?");
    return;
  }

  const question = params.question.trim();
  const excelRequested = /\b(?:excel|xls|xlsx|spreadsheet|google\s+sheets?|sheets?\s+file)\b/i.test(question);
  const viewerContext: CustomerPhoneViewerContext = {
    chatType: params.chatType,
    telegramUserId: params.telegramUserId,
    target,
  };

  if (isExportOnlyFollowUp(question)) {
    const cache = getLatestTelegramAgentExportCache({
      clinicId: target.clinicId,
      telegramChatId: params.chatId,
      telegramUserId: params.telegramUserId,
    });

    if (!cache) {
      await sendTelegramMessage(
        params.chatId,
        "I don’t have a recent table to export. Please ask for the report again, for example: top customers this month export csv.",
      );
      return;
    }

    const exportFile = buildGreatTimeAgentCsvExportFromTables({
      tables: cache.tables,
      resolvedAgent: cache.resolvedAgent,
      intent: cache.intent,
      period: cache.period,
      originalMessage: cache.originalMessage,
      now: cache.createdAt,
    });
    await sendTelegramDocument(params.chatId, {
      fileName: exportFile.fileName,
      content: exportFile.csv,
      caption: buildGreatTimeAgentCsvCaption({
        rowCount: exportFile.rowCount,
        fromPreviousResult: true,
        excelRequested: true,
      }),
    });
    return;
  }

  let effectiveQuestion = question;
  let entityContext = params.entityContext;
  let agent = params.agent;
  let followUpFromDate: string | undefined;
  let followUpToDate: string | undefined;
  if (!entityContext) {
    const recentPaymentContext = getRecentPaymentMethodContext({
      clinicId: target.clinicId,
      telegramChatId: params.chatId,
      telegramUserId: params.telegramUserId,
    });
    const recentPaymentResolution = resolveRecentPaymentMethodReference({
      message: question,
      context: recentPaymentContext,
    });
    const recentContext = getRecentAppointmentContext({
      clinicId: target.clinicId,
      telegramChatId: params.chatId,
      telegramUserId: params.telegramUserId,
    });
    const recentResolution = resolveRecentAppointmentReference({
      message: question,
      context: recentContext,
    });
    const shouldUsePaymentMethodContext =
      recentPaymentResolution.status === "resolved" &&
      (recentResolution.status === "none" ||
        recentPaymentResolution.context.createdAt >= (recentContext?.createdAt ?? 0));

    if (shouldUsePaymentMethodContext) {
      const method = recentPaymentResolution.item.paymentMethod;
      effectiveQuestion = `${question}\n${method} payment method details`;
      agent = "finance";
      if (!hasExplicitPeriodCue(question)) {
        followUpFromDate = recentPaymentResolution.context.period.fromDate;
        followUpToDate = recentPaymentResolution.context.period.toDate;
      }
    } else if (recentResolution.status === "resolved") {
      const item = recentResolution.item;
      if (recentResolution.action === "phone") {
        const phone = formatCustomerPhone(
          { fullPhone: item.fullPhone, maskedPhone: item.maskedPhone },
          viewerContext,
          { logContext: "appointment_context_phone" },
        );
        await sendTelegramMessage(
          params.chatId,
          [
            `${item.displayIndex}. ${item.customerName}`,
            `Phone: ${phone}`,
            `Service: ${item.serviceName}`,
            `Staff: ${item.staffName || "-"}`,
            `Time: ${item.appointmentTime}`,
          ].join("\n"),
          {
            replyMarkup: appointmentContextReplyMarkup({
              items: [item],
              clinicId: target.clinicId,
              telegramChatId: params.chatId,
              telegramUserId: params.telegramUserId,
            }),
          },
        );
        return;
      }

      entityContext = appointmentContextItemToCustomerEntityContext(item);
      agent = "customer_relationship";
      effectiveQuestion =
        recentResolution.action === "history"
          ? "Show this customer's treatment and purchase history"
          : "Tell me about this customer";
    } else if (recentResolution.status === "suggestion") {
      await sendTelegramMessage(
        params.chatId,
        buildAppointmentContextSuggestionMessage({
          query: recentResolution.query,
          item: recentResolution.item,
          viewerContext,
        }),
        {
          replyMarkup: appointmentContextReplyMarkup({
            items: [recentResolution.item],
            clinicId: target.clinicId,
            telegramChatId: params.chatId,
            telegramUserId: params.telegramUserId,
          }),
        },
      );
      return;
    } else if (recentResolution.status === "ambiguous") {
      await sendTelegramMessage(
        params.chatId,
        buildAppointmentContextChoiceMessage({
          query: recentResolution.query,
          items: recentResolution.items,
          viewerContext,
        }),
        {
          replyMarkup: appointmentContextReplyMarkup({
            items: recentResolution.items,
            clinicId: target.clinicId,
            telegramChatId: params.chatId,
            telegramUserId: params.telegramUserId,
          }),
        },
      );
      return;
    }
  }

  const response = await buildAgentHubReply({
    target,
    question: effectiveQuestion,
    telegramChatId: params.chatId,
    telegramUserId: params.telegramUserId,
    telegramMessageId: params.telegramMessageId,
    telegramCallbackDataType: params.telegramCallbackDataType,
    entityContext,
    agent,
    fromDate: followUpFromDate,
    toDate: followUpToDate,
  });
  const appointmentContextItems =
    response.resolvedAgent === "appointment"
      ? buildRecentAppointmentContextItemsFromResponse({
          response,
          viewerContext,
          clinicCode: target.clinicCode,
        })
      : [];

  const recentAppointmentContext = appointmentContextItems.length > 0
    ? saveRecentAppointmentContext({
      clinicId: target.clinicId,
      clinicCode: target.clinicCode,
      telegramChatId: params.chatId,
      telegramUserId: params.telegramUserId,
      appointments: appointmentContextItems,
    })
    : getRecentAppointmentContext({
        clinicId: target.clinicId,
        telegramChatId: params.chatId,
        telegramUserId: params.telegramUserId,
      });

  const paymentMethodContextItems = buildRecentPaymentMethodContextItemsFromResponse(response);
  if (paymentMethodContextItems.length > 0) {
    saveRecentPaymentMethodContext({
      clinicId: target.clinicId,
      clinicCode: target.clinicCode,
      telegramChatId: params.chatId,
      telegramUserId: params.telegramUserId,
      period: response.period,
      methods: paymentMethodContextItems,
    });
  }

  const cacheEntry =
    response.intent !== "unsupported_write_request" && hasExportableAgentTables(response)
      ? saveLatestTelegramAgentExportCache({
          clinicId: target.clinicId,
          clinicCode: target.clinicCode,
          telegramChatId: params.chatId,
          telegramUserId: params.telegramUserId,
          resolvedAgent: response.resolvedAgent,
          intent: response.intent,
          originalMessage: effectiveQuestion,
          period: response.period,
          tables: response.tables,
        })
      : null;

  const replyText = formatAgentHubTelegramReply(response, { viewerContext, clinicCode: target.clinicCode });
  const replyMarkup = buildAgentHubTelegramReplyMarkup(response, {
      appointmentContextItems,
      recentAppointmentContext,
      clinicId: target.clinicId,
      telegramChatId: params.chatId,
      telegramUserId: params.telegramUserId,
      exportCallbackData: cacheEntry ? `gtcsv:${cacheEntry.exportId}` : undefined,
    });
  const deliveryStartedAt = Date.now();
  const buttonCount = countInlineKeyboardButtons(replyMarkup);

  try {
    await sendTelegramMessage(params.chatId, replyText, {
      replyMarkup,
    });
    await updateAgentRunTrace(response.requestId, {
      status: "completed",
      currentStep: "Telegram delivery completed",
      telegramDeliveryStatus: "sent",
      telegramDeliveryLatencyMs: Date.now() - deliveryStartedAt,
      buttonCount,
      messageLength: replyText.length,
      updatedAt: nowIso(),
      completedAt: nowIso(),
    }).catch((error) => {
      console.warn("[telegram] failed to update AI delivery trace", error);
    });
  } catch (error) {
    await updateAgentRunTrace(response.requestId, {
      status: "failed",
      currentStep: "Telegram delivery failed",
      telegramDeliveryStatus: "failed",
      telegramDeliveryLatencyMs: Date.now() - deliveryStartedAt,
      buttonCount,
      messageLength: replyText.length,
      errorCategory: "telegram_send_failed",
      sanitizedError: sanitizeError(error),
      updatedAt: nowIso(),
      completedAt: nowIso(),
    }).catch((traceError) => {
      console.warn("[telegram] failed to update AI delivery failure trace", traceError);
    });
    throw error;
  }

  if (!isAgentCsvExportRequested(question)) {
    return;
  }

  if (!hasExportableAgentTables(response)) {
    await sendTelegramMessage(params.chatId, "I couldn't generate a CSV because this response doesn't contain table/list rows.");
    return;
  }

  const exportFile = buildGreatTimeAgentCsvExportFromTables({
    tables: response.tables,
    resolvedAgent: response.resolvedAgent,
    intent: response.intent,
    period: response.period,
    originalMessage: question,
  });
  await sendTelegramDocument(params.chatId, {
    fileName: exportFile.fileName,
    content: exportFile.csv,
    caption: buildGreatTimeAgentCsvCaption({
      rowCount: exportFile.rowCount,
      excelRequested,
    }),
  });
}

export function isTelegramBotConfigured() {
  return Boolean(env.TELEGRAM_BOT_TOKEN);
}

export async function getTelegramBotUsername() {
  if (env.TELEGRAM_BOT_USERNAME?.trim()) {
    return env.TELEGRAM_BOT_USERNAME.replace(/^@/, "").trim();
  }

  if (cachedBotUsername !== undefined) {
    return cachedBotUsername;
  }

  if (!env.TELEGRAM_BOT_TOKEN) {
    cachedBotUsername = null;
    return cachedBotUsername;
  }

  const me = await callTelegramApi<{ username?: string }>("getMe");
  cachedBotUsername = me.username ? me.username.replace(/^@/, "").trim() : null;
  return cachedBotUsername;
}

export async function getTelegramBotLinkMetadata(linkCode?: string | null) {
  const username = await getTelegramBotUsername();
  if (!username) {
    return {
      botUsername: null,
      botUrl: null,
      botDeepLink: null,
      botGroupDeepLink: null,
    };
  }

  const botUrl = `https://t.me/${username}`;
  return {
    botUsername: username,
    botUrl,
    botDeepLink: linkCode ? `${botUrl}?start=${encodeURIComponent(linkCode)}` : botUrl,
    botGroupDeepLink: linkCode ? `${botUrl}?startgroup=${encodeURIComponent(linkCode)}` : null,
  };
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  options?: {
    replyMarkup?: Record<string, unknown>;
  },
) {
  return callTelegramApi("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...(options?.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
  });
}

export async function sendTelegramDocument(
  chatId: string,
  params: {
    fileName: string;
    content: string | Buffer | Uint8Array;
    contentType?: string;
    caption?: string;
  },
) {
  const formData = new FormData();
  const contentType = params.contentType ?? "text/csv;charset=utf-8";
  const blobPart =
    typeof params.content === "string"
      ? params.content
      : (() => {
          const buffer = new ArrayBuffer(params.content.byteLength);
          new Uint8Array(buffer).set(params.content);
          return buffer;
        })();
  const blob = new Blob([blobPart], { type: contentType });

  formData.append("chat_id", chatId);
  if (params.caption) {
    formData.append("caption", params.caption);
  }
  formData.append("document", blob, params.fileName);

  return callTelegramMultipartApi("sendDocument", formData);
}

async function answerTelegramCallback(callbackQueryId: string, text?: string) {
  await callTelegramApi("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
}

async function handleSuggestedQuestionCallback(callback: TelegramCallbackQuery) {
  const key = callback.data?.match(/^gtask:([A-Za-z0-9]+)$/)?.[1];
  const chat = callback.message?.chat;

  if (!key || !chat) {
    await answerTelegramCallback(callback.id, "မေးခွန်းကို ပြန်မတွေ့ပါ။");
    await recordTelegramCallbackIssue({
      callback,
      errorCategory: "callback_data_invalid",
      currentStep: "Suggested question callback data was invalid",
    });
    return;
  }

  cleanupSuggestedQuestionCallbacks();
  const suggestion = suggestedQuestionCallbacks.get(key);
  if (!suggestion) {
    await answerTelegramCallback(callback.id, "ဒီ button သက်တမ်းကုန်သွားပါပြီ။ နောက်ဆုံး message က button ကို ပြန်နှိပ်ပါ။");
    await recordTelegramCallbackIssue({
      callback,
      chatId: String(chat.id),
      errorCategory: "telegram_callback_expired",
      currentStep: "Suggested question callback expired",
      callbackExpired: true,
    });
    return;
  }

  await answerTelegramCallback(callback.id, "GT Brain ကို မေးနေပါတယ်...");
  await handleAgentQuestion({
    chatId: String(chat.id),
    chatType: chat.type,
    question: suggestion.question,
    telegramUserId: callback.from?.id == null ? null : String(callback.from.id),
    telegramMessageId: callback.message?.message_id == null ? null : String(callback.message.message_id),
    telegramCallbackDataType: telegramCallbackDataType(callback.data),
  });
}

async function handleCsvExportCallback(callback: TelegramCallbackQuery) {
  const exportId = callback.data?.match(/^gtcsv:([A-Za-z0-9-]+)$/)?.[1];
  const chat = callback.message?.chat;

  if (!exportId || !chat) {
    await answerTelegramCallback(callback.id, "CSV export expired.");
    await recordTelegramCallbackIssue({
      callback,
      errorCategory: "callback_data_invalid",
      currentStep: "CSV callback data was invalid",
    });
    return;
  }

  const chatId = String(chat.id);
  const target = await getTelegramTargetByChatId(chatId);
  const telegramUserId = callback.from?.id == null ? null : String(callback.from.id);

  if (!target || !canTelegramUserChatWithAgent({ target, telegramUserId })) {
    await answerTelegramCallback(callback.id, "CSV export unavailable.");
    return;
  }

  const cache = getTelegramAgentExportCacheById({ exportId });
  if (!cache || cache.clinicId !== target.clinicId || cache.telegramChatId !== chatId) {
    await answerTelegramCallback(callback.id, "CSV export expired.");
    await recordTelegramCallbackIssue({
      callback,
      chatId,
      target,
      errorCategory: "telegram_callback_expired",
      currentStep: "CSV export callback expired",
      callbackExpired: true,
    });
    await sendTelegramMessage(chatId, "This CSV export expired. Please ask for the report again.");
    return;
  }

  await answerTelegramCallback(callback.id, "Preparing CSV...");
  const exportFile = buildGreatTimeAgentCsvExportFromTables({
    tables: cache.tables,
    resolvedAgent: cache.resolvedAgent,
    intent: cache.intent,
    period: cache.period,
    originalMessage: cache.originalMessage,
    now: cache.createdAt,
  });
  await sendTelegramDocument(chatId, {
    fileName: exportFile.fileName,
    content: exportFile.csv,
    caption: buildGreatTimeAgentCsvCaption({
      rowCount: exportFile.rowCount,
      fromPreviousResult: true,
      excelRequested: true,
    }),
  });
}

function callbackTokenMatchesRequest(params: {
  token: AppointmentCallbackToken;
  target: TelegramTargetStatus;
  chatId: string;
  telegramUserId: string | null;
}) {
  return (
    (!params.token.clinicId || params.token.clinicId === params.target.clinicId) &&
    (!params.token.telegramChatId || params.token.telegramChatId === params.chatId) &&
    (!params.token.telegramUserId || params.token.telegramUserId === params.telegramUserId)
  );
}

function appointmentFromToken(
  token: AppointmentCallbackToken,
  context: RecentAppointmentContext | null,
) {
  if (!context?.appointments.length) {
    return null;
  }

  return (
    context.appointments.find((item) => token.appointmentId && item.appointmentId === token.appointmentId) ??
    context.appointments.find((item) => token.customerId && item.customerId === token.customerId) ??
    null
  );
}

async function handleAppointmentSelectCallback(callback: TelegramCallbackQuery) {
  const key = callback.data?.match(/^apptsel:([A-Za-z0-9]+)$/)?.[1];
  const chat = callback.message?.chat;

  if (!key || !chat) {
    await answerTelegramCallback(callback.id, "Customer button expired.");
    await recordTelegramCallbackIssue({
      callback,
      errorCategory: "callback_data_invalid",
      currentStep: "Appointment selection callback data was invalid",
    });
    return;
  }

  const token = getAppointmentActionToken(key);
  const chatId = String(chat.id);
  const telegramUserId = callback.from?.id == null ? null : String(callback.from.id);
  const target = await getTelegramTargetByChatId(chatId);
  if (!target || !token || !callbackTokenMatchesRequest({ token, target, chatId, telegramUserId })) {
    await answerTelegramCallback(callback.id, "This customer button expired.");
    await recordTelegramCallbackIssue({
      callback,
      chatId,
      target,
      errorCategory: "telegram_callback_expired",
      currentStep: "Appointment selection callback expired",
      callbackExpired: true,
    });
    return;
  }

  if (!canTelegramUserChatWithAgent({ target, telegramUserId })) {
    await answerTelegramCallback(callback.id, "Customer action unavailable.");
    return;
  }

  const recentContext = getRecentAppointmentContext({
    clinicId: target.clinicId,
    telegramChatId: chatId,
    telegramUserId,
  });
  const appointmentItem = appointmentFromToken(token, recentContext);
  if (!appointmentItem) {
    await answerTelegramCallback(callback.id, "This customer button expired.");
    await recordTelegramCallbackIssue({
      callback,
      chatId,
      target,
      errorCategory: "appointment_context_missing",
      currentStep: "Appointment context missing for selection callback",
      callbackExpired: true,
    });
    await sendTelegramMessage(chatId, "ဒီ appointment button သက်တမ်းကုန်သွားပါပြီ။ Today appointment ကို ပြန်မေးပေးပါ။");
    return;
  }

  await answerTelegramCallback(callback.id, `Opening ${appointmentItem.customerName}...`);
  await handleAgentQuestion({
    chatId,
    chatType: chat.type,
    question: "Tell me about this customer",
    telegramUserId,
    telegramMessageId: callback.message?.message_id == null ? null : String(callback.message.message_id),
    telegramCallbackDataType: telegramCallbackDataType(callback.data),
    entityContext: appointmentContextItemToCustomerEntityContext(appointmentItem),
    agent: "customer_relationship",
  });
}

async function handleAppointmentPageCallback(callback: TelegramCallbackQuery) {
  const key = callback.data?.match(/^apptpg:([A-Za-z0-9]+)$/)?.[1];
  const chat = callback.message?.chat;

  if (!key || !chat) {
    await answerTelegramCallback(callback.id, "Appointment page expired.");
    await recordTelegramCallbackIssue({
      callback,
      errorCategory: "callback_data_invalid",
      currentStep: "Appointment page callback data was invalid",
    });
    return;
  }

  const token = getAppointmentActionToken(key);
  const chatId = String(chat.id);
  const telegramUserId = callback.from?.id == null ? null : String(callback.from.id);
  const target = await getTelegramTargetByChatId(chatId);
  if (!target || !token || !callbackTokenMatchesRequest({ token, target, chatId, telegramUserId })) {
    await answerTelegramCallback(callback.id, "Appointment page expired.");
    await recordTelegramCallbackIssue({
      callback,
      chatId,
      target,
      errorCategory: "telegram_callback_expired",
      currentStep: "Appointment page callback expired",
      callbackExpired: true,
    });
    return;
  }

  if (!canTelegramUserChatWithAgent({ target, telegramUserId })) {
    await answerTelegramCallback(callback.id, "Appointment page unavailable.");
    return;
  }

  const recentContext = getRecentAppointmentContext({
    clinicId: target.clinicId,
    telegramChatId: chatId,
    telegramUserId,
  });
  if (!recentContext?.appointments.length) {
    await answerTelegramCallback(callback.id, "Appointment page expired.");
    await recordTelegramCallbackIssue({
      callback,
      chatId,
      target,
      errorCategory: "appointment_context_missing",
      currentStep: "Appointment context missing for page callback",
      callbackExpired: true,
    });
    await sendTelegramMessage(chatId, "ဒီ appointment list သက်တမ်းကုန်သွားပါပြီ။ Today appointment ကို ပြန်မေးပေးပါ။");
    return;
  }

  const viewerContext: CustomerPhoneViewerContext = {
    chatType: chat.type,
    telegramUserId,
    target,
  };
  const page = token.page ?? 0;
  await answerTelegramCallback(callback.id, "Opening appointment page...");
  await sendTelegramMessage(chatId, buildAppointmentPageMessage({ context: recentContext, page, viewerContext }), {
    replyMarkup: buildAppointmentSelectionReplyMarkup({
      appointments: recentContext.appointments,
      clinicId: target.clinicId,
      telegramChatId: chatId,
      telegramUserId,
      page,
      includeBackToToday: true,
    }),
  });
}

async function handleCustomerActionCallback(callback: TelegramCallbackQuery) {
  const match = callback.data?.match(/^(customer_details|customer_history|customer_package|appointment_details):([A-Za-z0-9_-]+)$/);
  const action = match?.[1];
  const actionKey = match?.[2];
  const chat = callback.message?.chat;

  if (!action || !actionKey || !chat) {
    await answerTelegramCallback(callback.id, "Customer action expired.");
    await recordTelegramCallbackIssue({
      callback,
      errorCategory: "callback_data_invalid",
      currentStep: "Customer action callback data was invalid",
    });
    return;
  }

  const chatId = String(chat.id);
  const telegramUserId = callback.from?.id == null ? null : String(callback.from.id);
  const target = await getTelegramTargetByChatId(chatId);
  if (!target || !canTelegramUserChatWithAgent({ target, telegramUserId })) {
    await answerTelegramCallback(callback.id, "Customer action unavailable.");
    return;
  }

  const recentContext = getRecentAppointmentContext({
    clinicId: target.clinicId,
    telegramChatId: chatId,
    telegramUserId,
  });
  const appointmentItem =
    recentContext?.appointments.find((item) => item.customerId === actionKey) ??
    recentContext?.appointments.find((item) => item.appointmentId === actionKey);
  const cachedCustomer = getCustomerActionRef(actionKey);
  const entityContext =
    action === "appointment_details" && appointmentItem
      ? {
          entityType: "appointment" as const,
          entityId: appointmentItem.appointmentId,
          appointmentId: appointmentItem.appointmentId,
          appointmentTime: appointmentItem.appointmentTime,
          appointmentStatus: appointmentItem.appointmentStatus,
          customerKey: appointmentItem.customerId,
          displayName: appointmentItem.customerName,
          customerName: appointmentItem.customerName,
          customerPhone: appointmentItem.resolutionPhone ?? appointmentItem.fullPhone,
          customerPhoneMasked: appointmentItem.maskedPhone,
          serviceName: appointmentItem.serviceName,
          practitionerName: appointmentItem.staffName,
          rank: appointmentItem.displayIndex,
        }
      : appointmentItem
        ? appointmentContextItemToCustomerEntityContext(appointmentItem)
        : cachedCustomer?.entityContext;

  if (!entityContext) {
    await answerTelegramCallback(callback.id, "This customer button expired.");
    await recordTelegramCallbackIssue({
      callback,
      chatId,
      target,
      errorCategory: "appointment_context_missing",
      currentStep: "Customer action context missing",
      callbackExpired: true,
    });
    await sendTelegramMessage(chatId, "ဒီ customer button သက်တမ်းကုန်သွားပါပြီ။ Customer name or phone နဲ့ ပြန်ရှာပေးပါ။");
    return;
  }

  await answerTelegramCallback(callback.id, "Opening customer...");
  await handleAgentQuestion({
    chatId,
    chatType: chat.type,
    question:
      action === "appointment_details"
        ? "Show appointment details"
        : action === "customer_package"
        ? "Show this customer's package balance"
        : action === "customer_history"
        ? "Show this customer's treatment and purchase history"
        : "Tell me about this customer",
    telegramUserId,
    telegramMessageId: callback.message?.message_id == null ? null : String(callback.message.message_id),
    telegramCallbackDataType: telegramCallbackDataType(callback.data),
    entityContext,
    agent: action === "appointment_details" ? "appointment" : "customer_relationship",
  });
}

export async function handleTelegramUpdate(update: TelegramUpdate) {
  if (update.callback_query?.data?.startsWith("apptsel:")) {
    await handleAppointmentSelectCallback(update.callback_query);
    return;
  }

  if (update.callback_query?.data?.startsWith("apptpg:")) {
    await handleAppointmentPageCallback(update.callback_query);
    return;
  }

  if (
    update.callback_query?.data?.startsWith("customer_details:") ||
    update.callback_query?.data?.startsWith("customer_history:") ||
    update.callback_query?.data?.startsWith("customer_package:") ||
    update.callback_query?.data?.startsWith("appointment_details:")
  ) {
    await handleCustomerActionCallback(update.callback_query);
    return;
  }

  if (update.callback_query?.data?.startsWith("gtcsv:")) {
    await handleCsvExportCallback(update.callback_query);
    return;
  }

  if (update.callback_query?.data?.startsWith("gtask:")) {
    await handleSuggestedQuestionCallback(update.callback_query);
    return;
  }

  if (update.my_chat_member && didBotJoinChat(update.my_chat_member)) {
    try {
      await sendUsageMessage(String(update.my_chat_member.chat.id));
    } catch (error) {
      console.error("[telegram] failed to send group link instructions", error);
    }
    return;
  }

  const message = update.message ?? update.edited_message ?? update.channel_post ?? update.edited_channel_post;
  if (!message?.text || !message.chat) {
    return;
  }

  const chatId = String(message.chat.id);
  const chat: TelegramChatTarget = {
    id: chatId,
    type: message.chat.type,
    title: buildChatTitle(message.chat),
  };
  const text = message.text.trim();

  if (/^\/start(?:@\w+)?$/i.test(text) || /^\/help(?:@\w+)?$/i.test(text)) {
    await sendUsageMessage(chatId);
    return;
  }

  if (isAiRevenueFollowUpTelegramText(text) || isAiRevenueFollowUpSessionCommand(text)) {
    const reply = await buildAiRevenueFollowUpTelegramReply({
      chatId,
      chatType: message.chat.type,
      text,
      telegramUserId: message.from?.id == null ? null : String(message.from.id),
    });

    if (reply) {
      await sendTelegramMessage(chatId, reply);
    }
    return;
  }

  if (isSalesAssistantCommand(text)) {
    const reply = await buildTelegramSalesAssistantReply({
      chatId,
      text,
      telegramUserId: message.from?.id == null ? null : String(message.from.id),
    });

    if (reply) {
      await sendTelegramMessage(chatId, reply);
    }
    return;
  }

  const code = extractLinkCode(text);
  if (code) {
    try {
      const result = await redeemTelegramLinkCode({ code, chat });
      await sendTelegramMessage(
        chatId,
        `Telegram connected to ${result.clinicName || "your clinic"}.\n\nReports and Agent chat access can now be controlled from GT Settings.`,
      );
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : "Link code could not be used. Please generate a new code in GT.";
      await sendTelegramMessage(chatId, `GT Telegram link failed.\n\n${messageText}`);
    }
    return;
  }

  const agentQuestion = extractTelegramAgentQuestion(text, message.chat.type);
  if (agentQuestion !== null) {
    await handleAgentQuestion({
      chatId,
      chatType: message.chat.type,
      question: agentQuestion,
      telegramUserId: message.from?.id == null ? null : String(message.from.id),
      telegramMessageId: message.message_id == null ? null : String(message.message_id),
    });
  }
}

function didBotJoinChat(update: TelegramChatMemberUpdate) {
  const previousStatus = update.old_chat_member?.status;
  const nextStatus = update.new_chat_member?.status;

  return (
    (nextStatus === "member" || nextStatus === "administrator") &&
    previousStatus !== "member" &&
    previousStatus !== "administrator"
  );
}

export async function handleTelegramWebhook(update: TelegramUpdate, secretToken: string | undefined) {
  if (env.TELEGRAM_WEBHOOK_SECRET && secretToken !== env.TELEGRAM_WEBHOOK_SECRET) {
    throw new HttpError(401, "Invalid Telegram webhook secret.");
  }

  await handleTelegramUpdate(update);
}

export const __test = {
  clearAppointmentActionCallbacks() {
    appointmentActionCallbacks.clear();
  },
  getAppointmentActionToken(key: string) {
    return getAppointmentActionToken(key);
  },
  clearCustomerActionCallbacks() {
    customerActionCallbacks.clear();
  },
  getCustomerActionRef(key: string) {
    return getCustomerActionRef(key);
  },
};

export async function ensureTelegramWebhook() {
  if (!env.TELEGRAM_WEBHOOK_ENABLED || !env.TELEGRAM_BOT_TOKEN || !env.APP_BASE_URL) {
    return;
  }

  const webhookUrl = getExpectedTelegramWebhookUrl();
  await callTelegramApi("setWebhook", {
    url: webhookUrl,
    secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message", "edited_message", "channel_post", "edited_channel_post", "my_chat_member", "callback_query"],
  });
  console.log(`[telegram] webhook configured for ${webhookUrl}`);
}

export function getExpectedTelegramWebhookUrl() {
  return env.APP_BASE_URL
    ? `${env.APP_BASE_URL.replace(/\/$/, "")}/api/integrations/telegram/webhook`
    : "";
}

export async function getTelegramWebhookInfo() {
  return callTelegramApi<TelegramWebhookInfo>("getWebhookInfo");
}

async function pollTelegramUpdates(offset: number) {
  return callTelegramApi<TelegramUpdate[]>("getUpdates", {
    offset,
    timeout: 0,
    allowed_updates: ["message", "edited_message", "channel_post", "edited_channel_post", "my_chat_member"],
  });
}

export function startTelegramPolling() {
  if (pollingStarted || !env.TELEGRAM_POLLING_ENABLED || !env.TELEGRAM_BOT_TOKEN) {
    return;
  }

  pollingStarted = true;
  let offset = 0;

  const tick = async () => {
    try {
      const updates = await pollTelegramUpdates(offset);
      for (const update of updates) {
        offset = Math.max(offset, update.update_id + 1);
        await handleTelegramUpdate(update);
      }
    } catch (error) {
      console.error("[telegram] polling failed", error);
    } finally {
      setTimeout(() => {
        void tick();
      }, env.TELEGRAM_POLLING_INTERVAL_MS);
    }
  };

  void tick();
  console.log("[telegram] polling started");
}
