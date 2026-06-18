import { firestoreDb } from "../../config/firebase.js";
import { dedupeEntityRefs, isEntityRefFresh } from "./entity-context.js";
import { nowIso } from "./safety.js";
import type { GreatTimeAgentChatResponse, GreatTimeAgentEntityContext } from "./types.js";

const SESSIONS_COLLECTION = "gtAgentSessionsV1";
const ENTITY_REFS_COLLECTION = "gtAgentSessionEntityRefsV1";
const ENTITY_TTL_MS = 2 * 60 * 60 * 1000;

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
  response: GreatTimeAgentChatResponse;
  entityRefs: GreatTimeAgentEntityContext[];
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
  };
}
