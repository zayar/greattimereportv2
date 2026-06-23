import { firestoreDb } from "../../config/firebase.js";
import { env } from "../../config/env.js";
import { dedupeEntityRefs, isEntityRefFresh } from "./entity-context.js";
import { nowIso } from "./safety.js";
import { buildSessionSummaryId, getSessionSummaryV2, saveSessionSummaryV2 } from "./memory/memory.repository.js";
import type { GtAgentRelevantMemory, GtAgentSessionSummaryV2 } from "./memory/memory-types.js";
import type { GreatTimeAgentChatRequest, GreatTimeAgentChatResponse, GreatTimeAgentEntityContext } from "./types.js";

const SESSIONS_COLLECTION = "gtAgentSessionsV1";
const ENTITY_REFS_COLLECTION = "gtAgentSessionEntityRefsV1";
const ENTITY_TTL_MS = 2 * 60 * 60 * 1000;
const SUMMARY_TTL_MS = 24 * 60 * 60 * 1000;

function sessionRef(sessionId: string) {
  return firestoreDb().collection(SESSIONS_COLLECTION).doc(sessionId);
}

function entityRef(sessionId: string) {
  return firestoreDb().collection(ENTITY_REFS_COLLECTION).doc(sessionId);
}

export async function saveAgentSessionTurn(params: {
  clinicId: string;
  userId: string;
  sessionId: string;
  request?: GreatTimeAgentChatRequest;
  response: GreatTimeAgentChatResponse;
  entityRefs: GreatTimeAgentEntityContext[];
  usedMemories?: GtAgentRelevantMemory[];
}) {
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + ENTITY_TTL_MS).toISOString();
  const refs = dedupeEntityRefs(params.entityRefs).map((ref) => ({
    ...ref,
    sourceResponseId: ref.sourceResponseId ?? params.response.responseId,
  }));

  await Promise.all([
    sessionRef(params.sessionId).set(
      {
        clinicId: params.clinicId,
        userId: params.userId,
        sessionId: params.sessionId,
        updatedAt: createdAt,
        lastResponseId: params.response.responseId,
        lastResolvedAgent: params.response.resolvedAgent,
        lastIntent: params.response.intent,
      },
      { merge: true },
    ),
    entityRef(params.sessionId).set(
      {
        clinicId: params.clinicId,
        userId: params.userId,
        sessionId: params.sessionId,
        refs,
        expiresAt,
        updatedAt: createdAt,
      },
      { merge: true },
    ),
  ]);

  if (env.AGENT_MEMORY_V2_ENABLED) {
    await saveSessionSummaryV2(
      buildSessionSummaryFromTurn({
        clinicId: params.clinicId,
        userId: params.userId,
        sessionId: params.sessionId,
        request: params.request,
        response: params.response,
        entityRefs: refs,
        usedMemories: params.usedMemories ?? [],
        now: createdAt,
      }),
    ).catch(() => undefined);
  }
}

export async function getAgentSessionEntityRefs(params: {
  clinicId: string;
  userId: string;
  sessionId: string;
}) {
  const snapshot = await entityRef(params.sessionId).get();
  const data = snapshot.data();

  if (!data || data.clinicId !== params.clinicId || data.userId !== params.userId) {
    return [];
  }

  if (!isEntityRefFresh(typeof data.expiresAt === "string" ? data.expiresAt : null)) {
    return [];
  }

  return Array.isArray(data.refs) ? (data.refs as GreatTimeAgentEntityContext[]) : [];
}

export async function getAgentSession(params: {
  clinicId: string;
  userId: string;
  sessionId: string;
}) {
  const snapshot = await sessionRef(params.sessionId).get();
  const data = snapshot.data();

  if (!data || data.clinicId !== params.clinicId || data.userId !== params.userId) {
    return null;
  }

  return {
    sessionId: params.sessionId,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
    lastResponseId: typeof data.lastResponseId === "string" ? data.lastResponseId : null,
    lastResolvedAgent: typeof data.lastResolvedAgent === "string" ? data.lastResolvedAgent : null,
    lastIntent: typeof data.lastIntent === "string" ? data.lastIntent : null,
    entityRefs: await getAgentSessionEntityRefs(params),
    summaryV2: env.AGENT_MEMORY_V2_ENABLED ? await getSessionSummaryV2(params).catch(() => null) : null,
  };
}

export function isSessionSummaryFresh(summary: Pick<GtAgentSessionSummaryV2, "expiresAt">, now = Date.now()) {
  return new Date(summary.expiresAt).getTime() > now;
}

export function buildSessionSummaryFromTurn(params: {
  clinicId: string;
  userId: string;
  sessionId: string;
  request?: GreatTimeAgentChatRequest;
  response: GreatTimeAgentChatResponse;
  entityRefs: GreatTimeAgentEntityContext[];
  usedMemories: GtAgentRelevantMemory[];
  now?: string;
}): GtAgentSessionSummaryV2 {
  const updatedAt = params.now ?? nowIso();
  const expiresAt = new Date(new Date(updatedAt).getTime() + SUMMARY_TTL_MS).toISOString();
  const preferredResponseStyle =
    params.usedMemories.find((memory) => memory.memoryType === "response_style")?.content ?? null;
  const preferredResponseLanguage =
    params.usedMemories.find((memory) => memory.memoryType === "language_preference")?.content ?? null;

  return {
    id: buildSessionSummaryId({
      clinicId: params.clinicId,
      userId: params.userId,
      sessionId: params.sessionId,
    }),
    clinicId: params.clinicId,
    userId: params.userId,
    sessionId: params.sessionId,
    activeTopic: params.request?.message.slice(0, 240) ?? params.response.summary?.slice(0, 240) ?? params.response.intent,
    lastResolvedAgent: params.response.resolvedAgent,
    lastIntent: params.response.intent,
    selectedDateRange: {
      fromDate: params.request?.fromDate,
      toDate: params.request?.toDate,
      timezone: params.request?.timezone,
    },
    activeEntityRefs: params.entityRefs.slice(0, 12).map((ref) => ({
      entityType: ref.entityType,
      entityId: ref.entityId,
      displayName: ref.displayName,
      rank: ref.rank,
    })),
    unresolvedClarification: null,
    preferredResponseLanguage,
    preferredResponseStyle,
    lastRecommendationIds: (params.response.recommendations ?? [])
      .map((recommendation) => recommendation.recommendationId)
      .filter((id): id is string => Boolean(id)),
    recentTurnSummary: [params.response.summary ?? params.response.assistantMessage].filter(Boolean).slice(0, 4),
    usedMemoryIds: params.usedMemories.map((memory) => memory.id),
    updatedAt,
    expiresAt,
  };
}
