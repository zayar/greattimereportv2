import { z } from "zod";
import { env } from "../../config/env.js";
import { createAiProvider } from "../ai/provider.js";
import type { AiJsonProvider } from "../ai/provider.js";
import type { GtAgentRelevantMemory } from "./memory/memory-types.js";
import type { GreatTimeAgentChatResponse } from "./types.js";

const narrativeSchema = z.object({
  assistantMessage: z.string().min(1).max(900),
});

function stripJsonFences(payload: string) {
  return payload.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
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
  options?: { memories?: GtAgentRelevantMemory[]; provider?: AiJsonProvider | null; timeoutMs?: number },
) {
  if (!env.AGENT_NARRATIVE_ENABLED) {
    return { response, fallbackUsed: true };
  }

  const provider = options?.provider === undefined ? createAiProvider() : options.provider;
  if (!provider) {
    return { response, fallbackUsed: true };
  }

  try {
    const timeoutMs = options?.timeoutMs ?? env.AGENT_NARRATIVE_TIMEOUT_MS;
    const prompt = buildNarrativePrompt(response, options?.memories ?? []);
    const raw = env.AGENT_FAST_MODE_ENABLED
      ? await generateNarrativeJsonWithTimeout(provider, prompt, timeoutMs)
      : await provider.generateJson(prompt);

    if (!raw.trim()) {
      return { response, fallbackUsed: true };
    }

    const parsed = narrativeSchema.safeParse(JSON.parse(stripJsonFences(raw)));

    if (!parsed.success) {
      return { response, fallbackUsed: true };
    }

    return {
      response: {
        ...response,
        assistantMessage: parsed.data.assistantMessage,
      },
      fallbackUsed: false,
    };
  } catch {
    return { response, fallbackUsed: true };
  }
}
