import { env } from "../../config/env.js";
import { HttpError } from "../../utils/http-error.js";
import { redeemTelegramLinkCode } from "./storage.service.js";
import type { TelegramChatTarget } from "./types.js";

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
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
};

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
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
  const response = await fetch(getTelegramApiUrl(method), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = (await response.json()) as TelegramApiResponse<T>;

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
    "GT Telegram link ready.\n\nSend your link code here, or add this bot to a group and paste the code there to connect that target.",
  );
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
    };
  }

  const botUrl = `https://t.me/${username}`;
  return {
    botUsername: username,
    botUrl,
    botDeepLink: linkCode ? `${botUrl}?start=${encodeURIComponent(linkCode)}` : botUrl,
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
  const message = update.message ?? update.channel_post;
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

  const code = extractLinkCode(text);
  if (!code) {
    return;
  }

  try {
    const result = await redeemTelegramLinkCode({ code, chat });
    await sendTelegramMessage(
      chatId,
      `Telegram connected to ${result.clinicName || "your clinic"}.\n\nToday Appointment Report can now be enabled from GT Settings.`,
    );
  } catch (error) {
    const messageText =
      error instanceof Error ? error.message : "Link code could not be used. Please generate a new code in GT.";
    await sendTelegramMessage(chatId, `GT Telegram link failed.\n\n${messageText}`);
  }
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

  const webhookUrl = `${env.APP_BASE_URL.replace(/\/$/, "")}/api/integrations/telegram/webhook`;
  await callTelegramApi("setWebhook", {
    url: webhookUrl,
    secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message", "channel_post"],
  });
  console.log(`[telegram] webhook configured for ${webhookUrl}`);
}

async function pollTelegramUpdates(offset: number) {
  return callTelegramApi<TelegramUpdate[]>("getUpdates", {
    offset,
    timeout: 0,
    allowed_updates: ["message", "channel_post"],
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
