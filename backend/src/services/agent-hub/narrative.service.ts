import { createHash } from "node:crypto";
import { z } from "zod";
import { env } from "../../config/env.js";
import { createAiProvider } from "../ai/provider.js";
import type { AiJsonProvider } from "../ai/provider.js";
import type { GtAgentRelevantMemory } from "./memory/memory-types.js";
import type { GreatTimeAgentChatResponse } from "./types.js";

const narrativeSchema = z.object({
  assistantMessage: z.string().min(1).max(900),
});

const NARRATIVE_CACHE_TTL_MS = 5 * 60_000;
const FAST_DETERMINISTIC_INTENTS = new Set(["owner_daily_brief", "appointment_summary", "payment_summary"]);

type NarrativeCacheEntry = {
  response: GreatTimeAgentChatResponse;
  expiresAt: number;
};

const narrativeCache = new Map<string, NarrativeCacheEntry>();

function stripJsonFences(payload: string) {
  return payload.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
}

function hashText(value: string, length = 32) {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return '"__undefined__"';
  }
  if (value === null || typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") {
    return JSON.stringify(value.toString());
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(String(value));
}

function isSimpleTableResponse(response: GreatTimeAgentChatResponse) {
  const tables = response.tables ?? [];
  if (tables.length === 0 || tables.length > 2) {
    return false;
  }

  const rowCount = tables.reduce((sum, table) => sum + table.rows.length, 0);
  return rowCount > 0 && rowCount <= 50 && (response.recommendations?.length ?? 0) === 0;
}

function hasHighConfidenceDeterministicResponse(response: GreatTimeAgentChatResponse) {
  if (!["ok", "partial", "no_activity"].includes(response.dataStatus)) {
    return false;
  }

  return response.sources.length > 0 && Boolean(response.summary ?? response.assistantMessage);
}

export function shouldSkipNarrativeForFastIntent(response: GreatTimeAgentChatResponse) {
  if (!env.AGENT_NARRATIVE_SKIP_FAST_INTENTS) {
    return false;
  }

  if (!hasHighConfidenceDeterministicResponse(response)) {
    return false;
  }

  return FAST_DETERMINISTIC_INTENTS.has(response.intent) || isSimpleTableResponse(response);
}

function buildNarrativeCacheKey(response: GreatTimeAgentChatResponse, clinicId?: string) {
  const sourceCheckedAt = response.sources
    .map((source) => `${source.tool}:${source.checkedAt}:${source.dataStatus}`)
    .sort();
  const summaryHash = hashText(response.summary ?? response.assistantMessage ?? "");

  return hashText(
    stableStringify({
      clinicId: clinicId ?? "unknown",
      intent: response.intent,
      period: response.period,
      sourceCheckedAt,
      summaryHash,
    }),
    48,
  );
}

function getCachedNarrative(cacheKey: string, now = Date.now()) {
  const cached = narrativeCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= now) {
    narrativeCache.delete(cacheKey);
    return null;
  }

  return cached.response;
}

function setCachedNarrative(cacheKey: string, response: GreatTimeAgentChatResponse, now = Date.now()) {
  narrativeCache.set(cacheKey, {
    response,
    expiresAt: now + NARRATIVE_CACHE_TTL_MS,
  });

  if (narrativeCache.size > 500) {
    const oldestKey = narrativeCache.keys().next().value as string | undefined;
    if (oldestKey) {
      narrativeCache.delete(oldestKey);
    }
  }
}

export function clearAgentNarrativeCache() {
  narrativeCache.clear();
}

function buildMemoryDirectives(memories: GtAgentRelevantMemory[]) {
  return memories
    .filter((memory) => ["response_style", "language_preference", "priority_preference"].includes(memory.memoryType))
    .slice(0, 4)
    .map((memory) => memory.content);
}

function buildNarrativePrompt(response: GreatTimeAgentChatResponse, memories: GtAgentRelevantMemory[]) {
  return JSON.stringify({
    instruction:
      "Write one concise GreatTime owner-facing answer from these fixed facts. Do not add, remove, recalculate, or change any number. Return JSON only: {\"assistantMessage\":\"...\"}.",
    language: response.requestedAgent === "auto" ? "match user preference if obvious" : "concise",
    memoryDirectives: buildMemoryDirectives(memories),
    agent: response.resolvedAgent,
    intent: response.intent,
    dataStatus: response.dataStatus,
    deterministicSummary: response.summary ?? response.assistantMessage,
    customer360: response.customer360
      ? {
          ...response.customer360,
          identity: {
            customerKey: response.customer360.identity.customerKey,
            memberId: response.customer360.identity.memberId,
            displayName: response.customer360.identity.displayName,
            joinedDate: response.customer360.identity.joinedDate,
          },
          appointments: {
            current: (response.customer360.appointments.current ?? []).slice(0, 5),
            upcoming: (response.customer360.appointments.upcoming ?? []).slice(0, 5),
            recentCompleted: (response.customer360.appointments.recentCompleted ?? []).slice(0, 5),
          },
          payments: {
            ...response.customer360.payments,
            recentInvoices: response.customer360.payments.recentInvoices.slice(0, 5),
          },
          usage: {
            ...response.customer360.usage,
            topServices: response.customer360.usage.topServices.slice(0, 8),
            monthlyServiceUsage: response.customer360.usage.monthlyServiceUsage.slice(0, 12),
          },
        }
      : undefined,
    service360: response.service360
      ? {
          ...response.service360,
          demandPattern: {
            ...response.service360.demandPattern,
            trend: response.service360.demandPattern.trend.slice(0, 12),
          },
          therapists: {
            ...response.service360.therapists,
            performanceRows: response.service360.therapists.performanceRows.slice(0, 8),
          },
          customers: {
            topRows: response.service360.customers.topRows.slice(0, 6),
          },
          affinities: {
            boughtTogether: response.service360.affinities.boughtTogether.slice(0, 8),
            alsoUsedBySameCustomers: response.service360.affinities.alsoUsedBySameCustomers.slice(0, 8),
          },
          commercial: {
            ...response.service360.commercial,
            paymentMethodMix: response.service360.commercial.paymentMethodMix.slice(0, 8),
          },
        }
      : undefined,
    metrics: (response.metrics ?? []).slice(0, 8),
    tableTitles: (response.tables ?? []).map((table) => ({
      title: table.title,
      rowCount: table.rows.length,
    })),
    warnings: (response.warnings ?? []).slice(0, 4),
    sources: response.sources.map((source) => ({
      sourceName: source.sourceName,
      dataStatus: source.dataStatus,
      live: source.live,
      period: source.period,
    })),
  });
}

function generateNarrativeJsonWithTimeout(provider: AiJsonProvider, prompt: string, timeoutMs: number) {
  if (timeoutMs <= 0) {
    return provider.generateJson(prompt);
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  return new Promise<string>((resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Agent narrative timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    provider.generateJson(prompt, { timeoutMs }).then(resolve, reject).finally(() => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    });
  });
}

export async function enhanceAgentResponseNarrative(
  response: GreatTimeAgentChatResponse,
  options?: { memories?: GtAgentRelevantMemory[]; provider?: AiJsonProvider | null; timeoutMs?: number; clinicId?: string },
) {
  if (!env.AGENT_NARRATIVE_ENABLED) {
    return { response, fallbackUsed: true, narrativeSkipped: false, cacheHit: false };
  }

  if (shouldSkipNarrativeForFastIntent(response)) {
    return { response, fallbackUsed: false, narrativeSkipped: true, cacheHit: false };
  }

  const cacheKey = buildNarrativeCacheKey(response, options?.clinicId);
  if (env.AGENT_NARRATIVE_CACHE_ENABLED) {
    const cachedResponse = getCachedNarrative(cacheKey);
    if (cachedResponse) {
      return { response: cachedResponse, fallbackUsed: false, narrativeSkipped: false, cacheHit: true };
    }
  }

  const provider = options?.provider === undefined ? createAiProvider() : options.provider;
  if (!provider) {
    return { response, fallbackUsed: true, narrativeSkipped: false, cacheHit: false };
  }

  try {
    const timeoutMs = options?.timeoutMs ?? env.AGENT_NARRATIVE_TIMEOUT_MS;
    const prompt = buildNarrativePrompt(response, options?.memories ?? []);
    const raw = env.AGENT_FAST_MODE_ENABLED
      ? await generateNarrativeJsonWithTimeout(provider, prompt, timeoutMs)
      : await provider.generateJson(prompt);

    if (!raw.trim()) {
      return { response, fallbackUsed: true, narrativeSkipped: false, cacheHit: false };
    }

    const parsed = narrativeSchema.safeParse(JSON.parse(stripJsonFences(raw)));

    if (!parsed.success) {
      return { response, fallbackUsed: true, narrativeSkipped: false, cacheHit: false };
    }

    const narrativeResponse = {
      ...response,
      assistantMessage: parsed.data.assistantMessage,
    };

    if (env.AGENT_NARRATIVE_CACHE_ENABLED) {
      setCachedNarrative(cacheKey, narrativeResponse);
    }

    return {
      response: narrativeResponse,
      fallbackUsed: false,
      narrativeSkipped: false,
      cacheHit: false,
    };
  } catch {
    return { response, fallbackUsed: true, narrativeSkipped: false, cacheHit: false };
  }
}
