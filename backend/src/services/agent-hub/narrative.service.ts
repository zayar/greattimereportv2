import { z } from "zod";
import { createAiProvider } from "../ai/provider.js";
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

export async function enhanceAgentResponseNarrative(
  response: GreatTimeAgentChatResponse,
  options?: { memories?: GtAgentRelevantMemory[] },
) {
  const provider = createAiProvider();
  if (!provider) {
    return { response, fallbackUsed: true };
  }

  try {
    const raw = await provider.generateJson(buildNarrativePrompt(response, options?.memories ?? []));
    const parsed = narrativeSchema.safeParse(JSON.parse(stripJsonFences(raw)));

    if (!parsed.success) {
      return { response, fallbackUsed: true };
    }

    return {
      response: {
        ...response,
        assistantMessage: parsed.data.assistantMessage,
        summary: parsed.data.assistantMessage,
      },
      fallbackUsed: false,
    };
  } catch {
    return { response, fallbackUsed: true };
  }
}
