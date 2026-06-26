import { createHash } from "node:crypto";
import { env } from "../../config/env.js";
import { HttpError } from "../../utils/http-error.js";
import { hasFeatureAccess } from "../feature-access.service.js";
import { askAgentHub, buildLockedAgentHubResponse } from "../agent-hub/agent-hub.service.js";
import { isAgentCsvExportRequested, isExportOnlyFollowUp } from "../agent-hub/export-intent.js";
import type { Customer360FactPack, GreatTimeAgentChatResponse, GreatTimeAgentId } from "../agent-hub/types.js";
import { buildTelegramSalesAssistantReply } from "../gt-growth-ai/sales-assistant.service.js";
import { GT_GROWTH_AI_FEATURE_GATE } from "../../types/report-ai.js";
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
  const formatted = typeof value === "number" ? value.toLocaleString("en-US") : value;
  if (unit === "amount") {
    return `${formatted} ကျပ်`;
  }
  if (unit === "%") {
    return `${formatted}%`;
  }

  return unit ? `${formatted} ${unit}` : formatted;
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

function formatShortDateMyanmar(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return dateKey;
  }

  return date.toLocaleDateString("my-MM", {
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
  if (normalized === "year to date") {
    return "ဒီနှစ်အစမှ ယနေ့အထိ";
  }

  return label;
}

function formatResponsePeriod(response: GreatTimeAgentChatResponse) {
  const { period } = response;
  if (period.fromDate === period.toDate) {
    return `${translatePeriodLabel(period.label)} (${formatShortDateMyanmar(period.toDate)})`;
  }

  return `${translatePeriodLabel(period.label)} (${formatShortDateMyanmar(period.fromDate)} - ${formatShortDateMyanmar(period.toDate)})`;
}

function buildTelegramReplyHeader(response: GreatTimeAgentChatResponse) {
  const agentLabel = formatAgentLabelMyanmar(response.resolvedAgent);
  const answeredBy = response.autoMode ? `GT Brain → ${agentLabel}` : agentLabel;

  return ["GT Brain", `ဖြေဆိုသူ: ${answeredBy}`, `ကာလ: ${formatResponsePeriod(response)}`];
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

function formatDateTimeForOwner(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return "-";
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
    "matched customers": "တွေ့ရှိသော customer",
    "source lookback days": "စစ်ထားတဲ့ နောက်ကြည့်ရက်",
  };

  return map[normalized] ?? label;
}

function sanitizeOwnerFacingText(text: string) {
  return text
    .replace(
      /APICORE does not expose a treatment_started_at event here, so this uses booking status as a proxy and does not confirm exact treatment-start time\./gi,
      "Treatment စတင်ချိန်ကို စနစ်ထဲမှာ တိတိကျကျ မတွေ့ရလို့ booking status ကို အခြေခံပြီး ခန့်မှန်းထားပါတယ်။",
    )
    .replace(/APICORE booking ledger/gi, "appointment စာရင်း")
    .replace(/APICORE appointment ledger/gi, "appointment စာရင်း")
    .replace(/\bAPICORE\b/gi, "appointment စာရင်း")
    .replace(/BigQuery payment report/gi, "payment report")
    .replace(/BigQuery customer portal/gi, "customer report")
    .replace(/\bBigQuery\b/gi, "report data");
}

function formatAppointmentConversation(response: GreatTimeAgentChatResponse) {
  const serviceTable = response.tables?.find((table) => table.title === "Appointment services");
  const appointmentTable =
    response.tables?.find((table) => table.title === "Appointments") ??
    response.tables?.find((table) => /appointment/i.test(table.title) && table.title !== "Appointment services");
  const totalAppointments =
    response.metrics?.find((metric) => metric.label.toLowerCase() === "appointments")?.value ??
    appointmentTable?.rows.length ??
    0;
  const serviceCount =
    response.metrics?.find((metric) => metric.label.toLowerCase() === "services")?.value ??
    serviceTable?.rows.length ??
    0;
  const lines = [
    `ဒီနေ့ appointment စာရင်းကို စစ်ပြီးပါပြီ။ Appointment ${formatMetricValue(totalAppointments, undefined)} ခုရှိပြီး service အမျိုးအစား ${formatMetricValue(serviceCount, undefined)} ခု ပါပါတယ်။`,
  ];

  if (serviceTable?.rows.length) {
    lines.push("", "ဒီနေ့ appointment ထဲက service များ:");
    serviceTable.rows.slice(0, 25).forEach((row, index) => {
      const serviceName = stringValue(row, "serviceName", "Unknown service");
      const appointments = numberValue(row, "appointmentCount") ?? 0;
      const customers = numberValue(row, "customerCount") ?? 0;
      lines.push(`${index + 1}. ${serviceName} — appointment ${appointments.toLocaleString("en-US")} ခု၊ customer ${customers.toLocaleString("en-US")} ယောက်`);
    });

    if (serviceTable.rows.length > 25) {
      lines.push(`နောက်ထပ် service ${serviceTable.rows.length - 25} ခုရှိပါသေးတယ်။`);
    }
  }

  if (appointmentTable?.rows.length) {
    lines.push("", "Customer + service appointment စာရင်း:");
    appointmentTable.rows.slice(0, 15).forEach((row, index) => {
      const time = formatDateTimeForOwner(row.scheduledFrom);
      const customer = stringValue(row, "customerName", "Unknown customer");
      const service = stringValue(row, "serviceName", "Unknown service");
      const practitioner = stringValue(row, "practitionerName", "");
      const status = translateStatus(stringValue(row, "rawStatus", ""));
      const practitionerText = practitioner && practitioner !== "-" ? ` ${practitioner} က တာဝန်ယူထားပါတယ်။` : "";
      lines.push(`${index + 1}. ${time} — ${customer} အတွက် ${service} appointment ပါ။${practitionerText} အခြေအနေ: ${status}`);
    });

    if (appointmentTable.rows.length > 15) {
      lines.push(`နောက်ထပ် appointment ${appointmentTable.rows.length - 15} ခုကို GreatTime report ထဲမှာ ဆက်ကြည့်နိုင်ပါတယ်။`);
    }
  }

  return lines;
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
    const phone = stringValue(row, "maskedPhone", stringValue(row, "customerPhoneMasked", ""));
    const lastVisit = stringValue(row, "lastVisitDate", "");
    const packagePurchaseDate = stringValue(row, "lastPackagePurchaseDate", "");
    const packageService = stringValue(row, "lastPackageServiceName", stringValue(row, "lastPackageName", ""));
    const remaining = numberValue(row, "remainingPackageSessions");

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
    if (remaining != null) {
      parts.push(`package/session လက်ကျန် ${remaining.toLocaleString("en-US")}`);
    }
    lines.push(`${parts.join(" — ")}။`);
  });

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

function formatGenericTableConversation(response: GreatTimeAgentChatResponse) {
  const table = response.tables?.find((item) => item.rows.length > 0);
  if (!table) {
    return [];
  }

  const columns = table.columns.slice(0, 4);
  const lines = [`${table.title} ကို ဖတ်ရလွယ်အောင် ပြထားပါတယ်:`];
  table.rows.slice(0, 6).forEach((row, index) => {
    const values = columns
      .map((column) => `${column.title}: ${stringValue(row, column.key)}`)
      .join("၊ ");
    lines.push(`${index + 1}. ${values}။`);
  });

  return lines;
}

function formatConversationTablePreview(response: GreatTimeAgentChatResponse) {
  if (response.resolvedAgent === "appointment" || response.tables?.some((table) => table.title === "Appointment services")) {
    return formatAppointmentConversation(response);
  }

  const practitioner = formatPractitionerPerformanceConversation(response);
  if (practitioner.length) {
    return practitioner;
  }

  const service = formatServicePerformanceConversation(response);
  if (service.length) {
    return service;
  }

  const customers = formatCustomerMatchesConversation(response);
  if (customers.length) {
    return customers;
  }

  const purchases = formatCustomerPurchaseConversation(response);
  if (purchases.length) {
    return purchases;
  }

  return formatGenericTableConversation(response);
}

function formatCustomer360PackageLine(row: Customer360FactPack["packages"]["holdings"][number]) {
  const remaining = row.remainingSessions ?? 0;
  const total = row.totalSessions ?? 0;
  const latest = row.latestUsageDate ? ` | နောက်ဆုံး ${row.latestUsageDate}` : "";
  const therapist = row.latestTherapist ? ` | ${row.latestTherapist}` : "";

  return `- ${row.serviceName}: ကျန် ${remaining.toLocaleString("en-US")}/${total.toLocaleString("en-US")}${latest}${therapist}`;
}

function formatCustomer360TreatmentLine(row: Record<string, unknown>) {
  const date = typeof row.checkInTime === "string" ? row.checkInTime.slice(0, 10) : "-";
  const service = typeof row.serviceName === "string" ? row.serviceName : "Service";
  const therapist = typeof row.therapistName === "string" ? ` | ${row.therapistName}` : "";

  return `- ${date}: ${service}${therapist}`;
}

function formatCustomer360TelegramReply(response: GreatTimeAgentChatResponse) {
  const factPack = response.customer360;
  if (!factPack) {
    return "";
  }

  const packageRows = factPack.packages.holdings.filter((row) => (row.remainingSessions ?? 0) > 0).slice(0, 6);
  const recentTreatments = (factPack.appointments.recentCompleted ?? []).slice(0, 3);
  const topServices = factPack.usage.topServices.slice(0, 3);
  const lines = [...buildTelegramReplyHeader(response), "", sanitizeOwnerFacingText(response.summary || response.assistantMessage)];

  if (packageRows.length > 0) {
    lines.push("", "Package / service လက်ကျန်:");
    packageRows.forEach((row) => {
      lines.push(formatCustomer360PackageLine(row));
    });
  }

  if (recentTreatments.length > 0) {
    lines.push("", "နောက်ဆုံး treatment များ:");
    recentTreatments.forEach((row) => {
      lines.push(formatCustomer360TreatmentLine(row));
    });
  }

  if (topServices.length > 0) {
    lines.push("", "အသုံးများတဲ့ service:");
    topServices.forEach((row) => {
      const service = typeof row.serviceName === "string" ? row.serviceName : "Service";
      const usage = typeof row.totalUsage === "number" ? row.totalUsage.toLocaleString("en-US") : String(row.totalUsage ?? "-");
      lines.push(`- ${service}: ${usage} ကြိမ်`);
    });
  }

  if (factPack.recommendation) {
    lines.push("", `အကြံပြုချက်: ${sanitizeOwnerFacingText(factPack.recommendation.title)}`);
    factPack.recommendation.evidence.slice(0, 2).forEach((item) => {
      lines.push(`- ${sanitizeOwnerFacingText(item)}`);
    });
  }

  const message = lines.join("\n").trim();
  return message.length <= 3900 ? message : `${message.slice(0, 3890).trim()}\n...`;
}

export function formatAgentHubTelegramReply(response: GreatTimeAgentChatResponse) {
  if (response.customer360) {
    return formatCustomer360TelegramReply(response);
  }

  const tablePreview = formatConversationTablePreview(response);
  const lines = [...buildTelegramReplyHeader(response)];
  const metrics = (response.metrics ?? []).slice(0, 5);
  const warnings = (response.warnings ?? []).slice(0, 2);

  if (tablePreview.length > 0) {
    lines.push("", ...tablePreview);
  } else {
    lines.push("", sanitizeOwnerFacingText(response.summary || response.assistantMessage));
  }

  if (metrics.length > 0 && response.resolvedAgent !== "appointment") {
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

  return `ဆက်မေးခွန်း ${index + 1}`;
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

export function buildAgentHubTelegramReplyMarkup(
  response: GreatTimeAgentChatResponse,
  options?: {
    exportCallbackData?: string;
  },
) {
  const seenCategories = new Set<string>();
  const seenLabels = new Set<string>();
  const questions = (response.followUpQuestions ?? []).filter(Boolean).reduce<string[]>((selected, question) => {
    if (selected.length >= 3) {
      return selected;
    }

    const category = suggestionCategory(question);
    const label = suggestionLabel(question, selected.length);
    if (isRedundantSuggestion(response, category) || seenCategories.has(category) || seenLabels.has(label)) {
      return selected;
    }

    seenCategories.add(category);
    seenLabels.add(label);
    selected.push(question);
    return selected;
  }, []);

  if (questions.length === 0 && !options?.exportCallbackData) {
    return undefined;
  }

  return {
    inline_keyboard: [
      ...(options?.exportCallbackData
        ? [
            [
              {
                text: "⬇️ Download CSV",
                callback_data: options.exportCallbackData,
              },
            ],
          ]
        : []),
      ...questions.map((question, index) => [
        {
          text: suggestionLabel(question, index),
          callback_data: `gtask:${registerSuggestedQuestion(question)}`,
        },
      ]),
    ],
  };
}

function sanitizeSessionPart(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "unknown";
}

async function buildAgentHubReply(params: {
  target: TelegramTargetStatus;
  question: string;
  telegramUserId: string | null;
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
    agent: "auto" as const,
    message: params.question,
    aiLanguage: params.target.ownerAiLanguage,
    timezone: params.target.timezone,
  };

  if (!premium.enabled) {
    return buildLockedAgentHubResponse({ request, premium });
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
    },
  });
}

function hasExportableAgentTables(response: GreatTimeAgentChatResponse) {
  return response.tables?.some((table) => table.rows.length > 0) ?? false;
}

async function handleAgentQuestion(params: {
  chatId: string;
  chatType: TelegramChat["type"];
  question: string;
  telegramUserId: string | null;
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

  const response = await buildAgentHubReply({
    target,
    question,
    telegramUserId: params.telegramUserId,
  });

  const cacheEntry =
    response.intent !== "unsupported_write_request" && hasExportableAgentTables(response)
      ? saveLatestTelegramAgentExportCache({
          clinicId: target.clinicId,
          clinicCode: target.clinicCode,
          telegramChatId: params.chatId,
          telegramUserId: params.telegramUserId,
          resolvedAgent: response.resolvedAgent,
          intent: response.intent,
          originalMessage: question,
          period: response.period,
          tables: response.tables,
        })
      : null;

  await sendTelegramMessage(params.chatId, formatAgentHubTelegramReply(response), {
    replyMarkup: buildAgentHubTelegramReplyMarkup(response, {
      exportCallbackData: cacheEntry ? `gtcsv:${cacheEntry.exportId}` : undefined,
    }),
  });

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
    return;
  }

  cleanupSuggestedQuestionCallbacks();
  const suggestion = suggestedQuestionCallbacks.get(key);
  if (!suggestion) {
    await answerTelegramCallback(callback.id, "ဒီ button သက်တမ်းကုန်သွားပါပြီ။ နောက်ဆုံး message က button ကို ပြန်နှိပ်ပါ။");
    return;
  }

  await answerTelegramCallback(callback.id, "GT Brain ကို မေးနေပါတယ်...");
  await handleAgentQuestion({
    chatId: String(chat.id),
    chatType: chat.type,
    question: suggestion.question,
    telegramUserId: callback.from?.id == null ? null : String(callback.from.id),
  });
}

async function handleCsvExportCallback(callback: TelegramCallbackQuery) {
  const exportId = callback.data?.match(/^gtcsv:([A-Za-z0-9-]+)$/)?.[1];
  const chat = callback.message?.chat;

  if (!exportId || !chat) {
    await answerTelegramCallback(callback.id, "CSV export expired.");
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

export async function handleTelegramUpdate(update: TelegramUpdate) {
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
