import { randomUUID } from "node:crypto";
import type {
  GreatTimeAgentChatResponse,
  GreatTimeAgentId,
  GreatTimeAgentTable,
} from "../agent-hub/types.js";

const TELEGRAM_AGENT_EXPORT_CACHE_TTL_MS = 30 * 60_000;

export type TelegramAgentExportCacheEntry = {
  exportId: string;
  cacheKey: string;
  clinicId: string;
  clinicCode?: string;
  telegramChatId: string;
  telegramUserId: string | null;
  resolvedAgent: GreatTimeAgentId;
  intent: string;
  originalMessage: string;
  period: GreatTimeAgentChatResponse["period"];
  tableTitle: string;
  tables: GreatTimeAgentTable[];
  createdAt: number;
  expiresAt: number;
};

type TelegramAgentExportCacheIdentity = {
  clinicId: string;
  telegramChatId: string;
  telegramUserId: string | null;
  now?: Date | number | string;
};

type SaveTelegramAgentExportCacheInput = TelegramAgentExportCacheIdentity & {
  clinicCode?: string;
  resolvedAgent: GreatTimeAgentId;
  intent: string;
  originalMessage: string;
  period: GreatTimeAgentChatResponse["period"];
  tables?: GreatTimeAgentTable[];
};

const latestByCacheKey = new Map<string, TelegramAgentExportCacheEntry>();
const byExportId = new Map<string, TelegramAgentExportCacheEntry>();

function toTimestamp(now?: Date | number | string) {
  if (now === undefined) {
    return Date.now();
  }

  if (typeof now === "number") {
    return now;
  }

  const time = new Date(now).getTime();
  return Number.isFinite(time) ? time : Date.now();
}

function buildCacheKey(params: {
  clinicId: string;
  telegramChatId: string;
  telegramUserId: string | null;
}) {
  return `${params.clinicId}:${params.telegramChatId}:${params.telegramUserId ?? "unknown"}`;
}

function getFirstTableWithRows(tables?: GreatTimeAgentTable[]) {
  return tables?.find((table) => table.rows.length > 0) ?? null;
}

function hasExportableRows(entry: TelegramAgentExportCacheEntry) {
  return entry.tables.some((table) => table.rows.length > 0);
}

function deleteEntry(entry: TelegramAgentExportCacheEntry) {
  latestByCacheKey.delete(entry.cacheKey);
  byExportId.delete(entry.exportId);
}

function cleanupExpired(now: number) {
  latestByCacheKey.forEach((entry) => {
    if (entry.expiresAt <= now || !hasExportableRows(entry)) {
      deleteEntry(entry);
    }
  });
}

function getValidEntry(entry: TelegramAgentExportCacheEntry | undefined, now: number) {
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= now || !hasExportableRows(entry)) {
    deleteEntry(entry);
    return null;
  }

  return entry;
}

export function saveLatestTelegramAgentExportCache(
  input: SaveTelegramAgentExportCacheInput,
): TelegramAgentExportCacheEntry | null {
  const now = toTimestamp(input.now);
  cleanupExpired(now);

  const table = getFirstTableWithRows(input.tables);
  if (!table || !input.tables) {
    return null;
  }

  const cacheKey = buildCacheKey(input);
  const previous = latestByCacheKey.get(cacheKey);
  if (previous) {
    deleteEntry(previous);
  }

  const entry: TelegramAgentExportCacheEntry = {
    exportId: randomUUID(),
    cacheKey,
    clinicId: input.clinicId,
    clinicCode: input.clinicCode,
    telegramChatId: input.telegramChatId,
    telegramUserId: input.telegramUserId,
    resolvedAgent: input.resolvedAgent,
    intent: input.intent,
    originalMessage: input.originalMessage,
    period: input.period,
    tableTitle: table.title,
    tables: input.tables,
    createdAt: now,
    expiresAt: now + TELEGRAM_AGENT_EXPORT_CACHE_TTL_MS,
  };

  latestByCacheKey.set(cacheKey, entry);
  byExportId.set(entry.exportId, entry);
  return entry;
}

export function getLatestTelegramAgentExportCache(
  params: TelegramAgentExportCacheIdentity,
): TelegramAgentExportCacheEntry | null {
  const now = toTimestamp(params.now);
  cleanupExpired(now);
  return getValidEntry(latestByCacheKey.get(buildCacheKey(params)), now);
}

export function getTelegramAgentExportCacheById(params: {
  exportId: string;
  now?: Date | number | string;
}): TelegramAgentExportCacheEntry | null {
  const now = toTimestamp(params.now);
  cleanupExpired(now);
  return getValidEntry(byExportId.get(params.exportId), now);
}

export function clearLatestTelegramAgentExportCache(params: TelegramAgentExportCacheIdentity): void {
  const entry = latestByCacheKey.get(buildCacheKey(params));
  if (entry) {
    deleteEntry(entry);
  }
}

export const __test = {
  clearAll() {
    latestByCacheKey.clear();
    byExportId.clear();
  },
  size() {
    cleanupExpired(Date.now());
    return latestByCacheKey.size;
  },
};
