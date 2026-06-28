import { firestoreDb } from "../../config/firebase.js";
import { nowIso } from "./safety.js";
import type { AgentFeedbackInput } from "./types.js";
import { saveRecommendationOutcome } from "./memory/memory.repository.js";
import type { GtAgentRecommendationState } from "./memory/memory-types.js";

const FEEDBACK_COLLECTION = "gtAgentFeedbackEventsV1";

export type AgentFeedbackEventRecord = AgentFeedbackInput & {
  id: string;
  userId: string;
  userEmail?: string | null;
  feedbackType: NonNullable<AgentFeedbackInput["feedbackType"]>;
  createdAt: string;
  processedAt?: string | null;
};

function mapOutcomeState(outcome: AgentFeedbackInput["outcome"]): GtAgentRecommendationState | null {
  if (!outcome) {
    return null;
  }

  if (outcome === "messaged") {
    return "contacted";
  }

  return outcome;
}

export async function saveAgentFeedback(input: AgentFeedbackInput & {
  userId: string;
  userEmail?: string;
}) {
  const createdAt = nowIso();
  const doc = firestoreDb().collection(FEEDBACK_COLLECTION).doc();
  const feedbackType = input.feedbackType ?? input.rating;

  await doc.set({
    id: doc.id,
    clinicId: input.clinicId,
    userId: input.userId,
    userEmail: input.userEmail ?? null,
    sessionId: input.sessionId,
    requestId: input.requestId ?? null,
    responseId: input.responseId,
    recommendationId: input.recommendationId ?? null,
    recommendationType: input.recommendationType ?? null,
    opportunityKey: input.opportunityKey ?? null,
    targetCustomerKey: input.targetCustomerKey ?? null,
    feedbackType,
    rating: input.rating,
    note: input.note?.slice(0, 1000) ?? null,
    outcome: input.outcome ?? null,
    resolvedAgent: input.resolvedAgent ?? null,
    intent: input.intent ?? null,
    sourceTools: input.sourceTools ?? [],
    usedMemoryIds: input.usedMemoryIds ?? [],
    createdAt,
    processedAt: null,
  });

  const state = mapOutcomeState(input.outcome);
  if (input.recommendationId && state) {
    await saveRecommendationOutcome({
      id: input.recommendationId,
      recommendationId: input.recommendationId,
      clinicId: input.clinicId,
      userId: input.userId,
      sessionId: input.sessionId,
      requestId: input.requestId ?? null,
      responseId: input.responseId,
      resolvedAgent: input.resolvedAgent ?? null,
      intent: input.intent ?? null,
      recommendationType: input.recommendationType ?? null,
      opportunityKey: input.opportunityKey ?? null,
      targetCustomerKey: input.targetCustomerKey ?? null,
      state,
      sourceTools: input.sourceTools ?? [],
      sourceEvidenceRefs: [doc.id],
      shownAt: state === "shown" ? createdAt : null,
      acceptedAt: state === "accepted" ? createdAt : null,
      contactedAt: state === "contacted" ? createdAt : null,
      observedAt: ["booked", "paid", "visited", "replied"].includes(state) ? createdAt : null,
      verificationWindowDays: 30,
      createdAt,
      updatedAt: createdAt,
    });
  }

  return { id: doc.id, createdAt };
}

export async function listUnprocessedAgentFeedback(params: {
  clinicId: string;
  limit?: number;
}) {
  const snapshot = await firestoreDb()
    .collection(FEEDBACK_COLLECTION)
    .where("clinicId", "==", params.clinicId)
    .where("processedAt", "==", null)
    .limit(Math.min(Math.max(params.limit ?? 50, 1), 200))
    .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as AgentFeedbackInput & {
      userId: string;
      createdAt: string;
    }),
  }));
}

function isAgentFeedbackEventRecord(data: FirebaseFirestore.DocumentData | undefined): data is AgentFeedbackEventRecord {
  return Boolean(data?.id && data?.clinicId && data?.responseId && data?.feedbackType && data?.createdAt);
}

export async function listRecentAgentFeedbackEvents(params: {
  clinicId?: string;
  since: Date;
  limit?: number;
}) {
  const db = firestoreDb();
  const limit = Math.min(Math.max(params.limit ?? 500, 1), 2_000);
  const sinceMs = params.since.getTime();
  const collection = db.collection(FEEDBACK_COLLECTION);
  const queries: Array<() => Promise<FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>>> = [];

  if (params.clinicId) {
    queries.push(() =>
      collection
        .where("clinicId", "==", params.clinicId)
        .orderBy("createdAt", "desc")
        .limit(limit)
        .get(),
    );
    queries.push(() => collection.where("clinicId", "==", params.clinicId).limit(limit).get());
  } else {
    queries.push(() => collection.orderBy("createdAt", "desc").limit(limit).get());
    queries.push(() => collection.limit(limit).get());
  }

  for (const query of queries) {
    try {
      const snapshot = await query();
      return snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter(isAgentFeedbackEventRecord)
        .filter((event) => new Date(event.createdAt).getTime() >= sinceMs)
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
        .slice(0, limit);
    } catch {
      // Try the less index-sensitive fallback query.
    }
  }

  return [];
}

export async function markAgentFeedbackProcessed(params: {
  feedbackIds: string[];
  processedAt?: string;
}) {
  if (params.feedbackIds.length === 0) {
    return;
  }

  const db = firestoreDb();
  const batch = db.batch();
  const processedAt = params.processedAt ?? nowIso();

  params.feedbackIds.slice(0, 450).forEach((id) => {
    batch.set(
      db.collection(FEEDBACK_COLLECTION).doc(id),
      {
        processedAt,
      },
      { merge: true },
    );
  });

  await batch.commit();
}
