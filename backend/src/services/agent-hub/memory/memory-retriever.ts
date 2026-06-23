import { env } from "../../../config/env.js";
import type { GreatTimeAgentChatRequest, GreatTimeAgentIntentPlan } from "../types.js";
import { listCandidateMemories } from "./memory.repository.js";
import type { GtAgentMemoryContext, GtAgentMemoryRecord, GtAgentRelevantMemory } from "./memory-types.js";

function tokenize(value: string) {
  return new Set(
    value
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 3),
  );
}

function lexicalScore(query: string, content: string) {
  const queryTokens = tokenize(query);
  if (queryTokens.size === 0) {
    return 0;
  }

  const contentTokens = tokenize(content);
  let matches = 0;

  queryTokens.forEach((token) => {
    if (contentTokens.has(token)) {
      matches += 1;
    }
  });

  return matches / queryTokens.size;
}

function recencyScore(memory: GtAgentMemoryRecord, now: Date) {
  const observed = new Date(memory.lastObservedAt ?? memory.updatedAt).getTime();
  if (!Number.isFinite(observed)) {
    return 0;
  }

  const days = Math.max(0, (now.getTime() - observed) / 86_400_000);
  return Math.max(0, 1 - days / 90);
}

export function rankMemoriesForRequest(params: {
  memories: GtAgentMemoryRecord[];
  clinicId: string;
  userId: string;
  request: Pick<GreatTimeAgentChatRequest, "message">;
  plan: Pick<GreatTimeAgentIntentPlan, "resolvedAgent" | "intent">;
  max?: number;
  now?: Date;
}): GtAgentRelevantMemory[] {
  const now = params.now ?? new Date();

  return params.memories
    .filter((memory) => memory.clinicId === params.clinicId)
    .filter((memory) => memory.status === "active")
    .filter((memory) => !memory.userId || memory.userId === params.userId)
    .filter((memory) => !memory.validUntil || new Date(memory.validUntil).getTime() > now.getTime())
    .map((memory) => {
      const exactUserScope = memory.userId === params.userId ? 2 : 0;
      const agentScore = memory.agentId === params.plan.resolvedAgent ? 1 : memory.agentId ? -0.5 : 0;
      const intentScore = memory.intent === params.plan.intent ? 1 : memory.intent ? -0.25 : 0;
      const textScore = lexicalScore(params.request.message, memory.content);
      const confidenceScore = memory.confidence;
      const freshnessScore = recencyScore(memory, now);
      const relevanceScore =
        exactUserScope +
        agentScore +
        intentScore +
        textScore * 1.5 +
        confidenceScore +
        freshnessScore * 0.5;

      return {
        ...memory,
        relevanceScore,
      };
    })
    .sort((left, right) => {
      if (right.relevanceScore !== left.relevanceScore) {
        return right.relevanceScore - left.relevanceScore;
      }

      return right.updatedAt.localeCompare(left.updatedAt);
    })
    .slice(0, params.max ?? 6);
}

export async function retrieveMemoryContext(params: {
  clinicId: string;
  userId: string;
  request: GreatTimeAgentChatRequest;
  plan: GreatTimeAgentIntentPlan;
}): Promise<GtAgentMemoryContext> {
  if (!env.AGENT_MEMORY_V2_ENABLED) {
    return { memories: [], usedMemoryIds: [] };
  }

  const memories = await listCandidateMemories({
    clinicId: params.clinicId,
    userId: params.userId,
    limit: 50,
  });
  const ranked = rankMemoriesForRequest({
    memories,
    clinicId: params.clinicId,
    userId: params.userId,
    request: params.request,
    plan: params.plan,
    max: 6,
  });

  return {
    memories: ranked,
    usedMemoryIds: ranked.map((memory) => memory.id),
  };
}
