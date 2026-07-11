import { firestoreDb } from "../../config/firebase.js";
import { env } from "../../config/env.js";
import { dedupeEntityRefs, isEntityRefFresh } from "./entity-context.js";
import { nowIso } from "./safety.js";
import { buildSessionSummaryId, getSessionSummaryV2, saveSessionSummaryV2 } from "./memory/memory.repository.js";
import type { GtAgentRelevantMemory, GtAgentSessionSummaryV2 } from "./memory/memory-types.js";
import type { GreatTimeAgentChatRequest, GreatTimeAgentChatResponse, GreatTimeAgentEntityContext } from "./types.js";

const SESSIONS_COLLECTION = "gtAgentSessionsV1";
const ENTITY_REFS_COLLECTION = "gtAgentSessionEntityRefsV1";
const RESPONSE_CONTEXTS_COLLECTION = "gtAgentResponseContextsV1";
const ENTITY_TTL_MS = 2 * 60 * 60 * 1000;
const SUMMARY_TTL_MS = 24 * 60 * 60 * 1000;

function sessionRef(sessionId: string) {
  return firestoreDb().collection(SESSIONS_COLLECTION).doc(sessionId);
}

function entityRef(sessionId: string) {
  return firestoreDb().collection(ENTITY_REFS_COLLECTION).doc(sessionId);
}

function responseContextRef(responseId: string) {
  return firestoreDb().collection(RESPONSE_CONTEXTS_COLLECTION).doc(responseId);
}

export type AgentResponseContext = {
  clinicId: string;
  userId: string;
  sessionId: string;
  requestId: string;
  responseId: string;
  resolvedAgent: GreatTimeAgentChatResponse["resolvedAgent"];
  intent: string;
  recommendationIds: string[];
  sourceTools: string[];
  usedMemoryIds: string[];
  createdAt: string;
  expiresAt: string;
};

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
  const responseContext: AgentResponseContext = {
    clinicId: params.clinicId,
    userId: params.userId,
    sessionId: params.sessionId,
    requestId: params.response.requestId,
    responseId: params.response.responseId,
    resolvedAgent: params.response.resolvedAgent,
    intent: params.response.intent,
    recommendationIds: (params.response.recommendations ?? [])
      .map((recommendation) => recommendation.recommendationId)
      .filter((id): id is string => Boolean(id)),
    sourceTools: [...new Set(params.response.sources.map((source) => source.tool))],
    usedMemoryIds: params.usedMemories?.map((memory) => memory.id) ?? [],
    createdAt,
    expiresAt: new Date(Date.now() + SUMMARY_TTL_MS).toISOString(),
  };

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
    responseContextRef(params.response.responseId).set(responseContext, { merge: true }),
  ]);

  if (env.AGENT_MEMORY_V2_ENABLED) {
    const previousSummary = await getSessionSummaryV2({
      clinicId: params.clinicId,
      userId: params.userId,
      sessionId: params.sessionId,
    }).catch(() => null);

    await saveSessionSummaryV2(
      buildSessionSummaryFromTurn({
        clinicId: params.clinicId,
        userId: params.userId,
        sessionId: params.sessionId,
        request: params.request,
        response: params.response,
        entityRefs: refs,
        usedMemories: params.usedMemories ?? [],
        previousSummary,
        now: createdAt,
      }),
    ).catch(() => undefined);
  }
}

function isAgentResponseContext(data: FirebaseFirestore.DocumentData | undefined): data is AgentResponseContext {
  return Boolean(data?.clinicId && data?.userId && data?.sessionId && data?.requestId && data?.responseId && data?.createdAt);
}

export async function getAgentResponseContext(params: {
  clinicId: string;
  userId: string;
  sessionId: string;
  responseId: string;
}) {
  const snapshot = await responseContextRef(params.responseId).get();
  const data = snapshot.data();

  if (
    !isAgentResponseContext(data) ||
    data.clinicId !== params.clinicId ||
    data.userId !== params.userId ||
    data.sessionId !== params.sessionId ||
    (data.expiresAt && new Date(data.expiresAt).getTime() <= Date.now())
  ) {
    return null;
  }

  return data;
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
  previousSummary?: GtAgentSessionSummaryV2 | null;
  now?: string;
}): GtAgentSessionSummaryV2 {
  const updatedAt = params.now ?? nowIso();
  const expiresAt = new Date(new Date(updatedAt).getTime() + SUMMARY_TTL_MS).toISOString();
  const preferredResponseStyle =
    params.usedMemories.find((memory) => memory.memoryType === "response_style")?.content ?? null;
  const preferredResponseLanguage =
    params.usedMemories.find((memory) => memory.memoryType === "language_preference")?.content ?? null;
  const activeEntityRefs = mergeSummaryEntityRefs(
    params.entityRefs.map((ref) => ({
      entityType: ref.entityType,
      entityId: ref.entityId,
      displayName: ref.displayName,
      rank: ref.rank,
    })),
    params.previousSummary?.activeEntityRefs ?? [],
  );
  const currentTurnSummary = params.response.summary ?? params.response.assistantMessage;
  const recentTurnSummary = [
    ...(params.previousSummary?.recentTurnSummary ?? []),
    currentTurnSummary,
  ].filter(Boolean).slice(-6);

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
      fromDate: params.response.period.fromDate,
      toDate: params.response.period.toDate,
      label: params.response.period.label,
      timezone: params.request?.timezone ?? params.previousSummary?.selectedDateRange.timezone,
    },
    activeEntityRefs,
    unresolvedClarification: params.previousSummary?.unresolvedClarification ?? null,
    preferredResponseLanguage: preferredResponseLanguage ?? params.previousSummary?.preferredResponseLanguage ?? null,
    preferredResponseStyle: preferredResponseStyle ?? params.previousSummary?.preferredResponseStyle ?? null,
    lastRecommendationIds: (params.response.recommendations ?? [])
      .map((recommendation) => recommendation.recommendationId)
      .filter((id): id is string => Boolean(id)),
    recentTurnSummary,
    usedMemoryIds: params.usedMemories.map((memory) => memory.id),
    updatedAt,
    expiresAt,
  };
}

function mergeSummaryEntityRefs(
  current: GtAgentSessionSummaryV2["activeEntityRefs"],
  previous: GtAgentSessionSummaryV2["activeEntityRefs"],
) {
  const seen = new Set<string>();
  const merged: GtAgentSessionSummaryV2["activeEntityRefs"] = [];

  [...current, ...previous].forEach((ref) => {
    const key = `${ref.entityType}:${ref.entityId}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    merged.push(ref);
  });

  return merged.slice(0, 12);
}
