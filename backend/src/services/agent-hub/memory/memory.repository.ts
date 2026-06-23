import { firestoreDb } from "../../../config/firebase.js";
import {
  GT_AGENT_CLINIC_MEMORIES_COLLECTION,
  GT_AGENT_FACT_SNAPSHOTS_COLLECTION,
  GT_AGENT_INSIGHT_CARDS_COLLECTION,
  GT_AGENT_RECOMMENDATION_OUTCOMES_COLLECTION,
  GT_AGENT_SESSION_SUMMARIES_COLLECTION,
  GT_AGENT_USER_PREFERENCES_COLLECTION,
  type GtAgentFactSnapshot,
  type GtAgentInsightCard,
  type GtAgentMemoryRecord,
  type GtAgentRecommendationOutcome,
  type GtAgentSessionSummaryV2,
} from "./memory-types.js";

function userPreferenceCollection() {
  return firestoreDb().collection(GT_AGENT_USER_PREFERENCES_COLLECTION);
}

function clinicMemoryCollection() {
  return firestoreDb().collection(GT_AGENT_CLINIC_MEMORIES_COLLECTION);
}

function sessionSummaryCollection() {
  return firestoreDb().collection(GT_AGENT_SESSION_SUMMARIES_COLLECTION);
}

function recommendationOutcomeCollection() {
  return firestoreDb().collection(GT_AGENT_RECOMMENDATION_OUTCOMES_COLLECTION);
}

function insightCardCollection() {
  return firestoreDb().collection(GT_AGENT_INSIGHT_CARDS_COLLECTION);
}

function factSnapshotCollection() {
  return firestoreDb().collection(GT_AGENT_FACT_SNAPSHOTS_COLLECTION);
}

function isMemoryRecord(data: FirebaseFirestore.DocumentData | undefined): data is GtAgentMemoryRecord {
  return Boolean(data?.id && data?.clinicId && data?.memoryType && data?.content);
}

function sessionSummaryId(params: { clinicId: string; userId: string; sessionId: string }) {
  return `${encodeURIComponent(params.clinicId)}__${encodeURIComponent(params.userId)}__${encodeURIComponent(params.sessionId)}`;
}

export async function saveMemoryRecord(memory: GtAgentMemoryRecord) {
  const collection = memory.userId ? userPreferenceCollection() : clinicMemoryCollection();
  await collection.doc(memory.id).set(memory, { merge: true });
}

export async function listCandidateMemories(params: {
  clinicId: string;
  userId: string;
  limit?: number;
}) {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 100);
  const [userSnapshot, clinicSnapshot] = await Promise.all([
    userPreferenceCollection().where("clinicId", "==", params.clinicId).where("userId", "==", params.userId).limit(limit).get(),
    clinicMemoryCollection().where("clinicId", "==", params.clinicId).limit(limit).get(),
  ]);

  return [...userSnapshot.docs, ...clinicSnapshot.docs]
    .map((doc) => doc.data())
    .filter(isMemoryRecord)
    .slice(0, limit);
}

export async function saveSessionSummaryV2(summary: GtAgentSessionSummaryV2) {
  await sessionSummaryCollection().doc(summary.id).set(summary, { merge: true });
}

export async function getSessionSummaryV2(params: {
  clinicId: string;
  userId: string;
  sessionId: string;
}) {
  const snapshot = await sessionSummaryCollection().doc(sessionSummaryId(params)).get();
  const data = snapshot.data() as GtAgentSessionSummaryV2 | undefined;

  if (!data || data.clinicId !== params.clinicId || data.userId !== params.userId) {
    return null;
  }

  if (new Date(data.expiresAt).getTime() <= Date.now()) {
    return null;
  }

  return data;
}

export function buildSessionSummaryId(params: { clinicId: string; userId: string; sessionId: string }) {
  return sessionSummaryId(params);
}

export async function saveRecommendationOutcome(outcome: GtAgentRecommendationOutcome) {
  await recommendationOutcomeCollection().doc(outcome.id).set(outcome, { merge: true });
}

export async function saveInsightCard(card: GtAgentInsightCard) {
  await insightCardCollection().doc(card.id).set(card, { merge: true });
}

export async function getInsightCardById(cardId: string) {
  const snapshot = await insightCardCollection().doc(cardId).get();
  return (snapshot.data() as GtAgentInsightCard | undefined) ?? null;
}

export async function saveFactSnapshot(snapshot: GtAgentFactSnapshot) {
  await factSnapshotCollection().doc(snapshot.id).set(snapshot, { merge: true });
}

export async function countActiveMemories(params: { clinicId: string }) {
  const [userSnapshot, clinicSnapshot] = await Promise.all([
    userPreferenceCollection().where("clinicId", "==", params.clinicId).where("status", "==", "active").get(),
    clinicMemoryCollection().where("clinicId", "==", params.clinicId).where("status", "==", "active").get(),
  ]);

  return userSnapshot.size + clinicSnapshot.size;
}
