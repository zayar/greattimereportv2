import { env } from "../../config/env.js";
import { HttpError } from "../../utils/http-error.js";
import { hasFeatureAccess } from "../feature-access.service.js";
import { askAgentHub, buildLockedAgentHubResponse } from "../agent-hub/agent-hub.service.js";
import type { GreatTimeAgentChatResponse } from "../agent-hub/types.js";
import { buildTelegramSalesAssistantReply } from "../gt-growth-ai/sales-assistant.service.js";
import { GT_GROWTH_AI_FEATURE_GATE } from "../../types/report-ai.js";
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

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
  my_chat_member?: TelegramChatMemberUpdate;
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
  return unit ? `${formatted} ${unit}` : formatted;
}

function formatTablePreview(response: GreatTimeAgentChatResponse) {
  const table = response.tables?.find((item) => item.rows.length > 0);
  if (!table) {
    return [];
  }

  const columns = table.columns.slice(0, 4);
  const rows = table.rows.slice(0, 5).map((row, index) => {
    const values = columns
      .map((column) => {
        const value = row[column.key];
        return value == null || value === "" ? "-" : String(value).slice(0, 48);
      })
      .join(" | ");

    return `${index + 1}. ${values}`;
  });

  return [`${table.title}:`, ...rows];
}

export function formatAgentHubTelegramReply(response: GreatTimeAgentChatResponse) {
  const lines = ["GT Agent", "", response.summary || response.assistantMessage];
  const metrics = (response.metrics ?? []).slice(0, 5);
  const tablePreview = formatTablePreview(response);
  const warnings = (response.warnings ?? []).slice(0, 2);
  const sources = response.sources.slice(0, 3);
  const followUps = (response.followUpQuestions ?? []).slice(0, 3);

  if (metrics.length > 0) {
    lines.push("", "Metrics:");
    metrics.forEach((metric) => {
      lines.push(`- ${metric.label}: ${formatMetricValue(metric.value, metric.unit)}`);
    });
  }

  if (tablePreview.length > 0) {
    lines.push("", ...tablePreview);
  }

  if (warnings.length > 0) {
    lines.push("", "Notes:");
    warnings.forEach((warning) => {
      lines.push(`- ${warning.title}: ${warning.message}`);
    });
  }

  if (sources.length > 0) {
    lines.push("", "Sources:");
    sources.forEach((source) => {
      lines.push(`- ${source.sourceName}: ${source.dataStatus}${source.live ? " live" : ""}`);
    });
  }

  if (followUps.length > 0) {
    lines.push("", "Try next:");
    followUps.forEach((question) => {
      lines.push(`- /ask ${question}`);
    });
  }

  const message = lines.join("\n").trim();
  return message.length <= 3900 ? message : `${message.slice(0, 3890).trim()}\n...`;
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

async function handleAgentQuestion(params: {
  chatId: string;
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
        ? "You are not allowed to chat with GT Agent from this Telegram target. Scheduled reports can still be delivered here."
        : "This Telegram target is report-only. Enable Agent chat for this target in GreatTime Settings > Telegram.",
    );
    return;
  }

  if (!params.question.trim()) {
    await sendTelegramMessage(params.chatId, "Send /ask followed by a clinic question, for example: /ask How much did we collect today?");
    return;
  }

  const response = await buildAgentHubReply({
    target,
    question: params.question.trim(),
    telegramUserId: params.telegramUserId,
  });
  await sendTelegramMessage(params.chatId, formatAgentHubTelegramReply(response));
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

export async function sendTelegramMessage(chatId: string, text: string) {
  return callTelegramApi("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });
}

export async function handleTelegramUpdate(update: TelegramUpdate) {
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
    allowed_updates: ["message", "edited_message", "channel_post", "edited_channel_post", "my_chat_member"],
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
