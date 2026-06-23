import { firestoreDb } from "../../config/firebase.js";
import { nowIso } from "./safety.js";
import type { AgentFeedbackInput } from "./types.js";
import { saveRecommendationOutcome } from "./memory/memory.repository.js";
import type { GtAgentRecommendationState } from "./memory/memory-types.js";

const FEEDBACK_COLLECTION = "gtAgentFeedbackEventsV1";

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
    feedbackType,
    rating: input.rating,
    note: input.note?.slice(0, 1000) ?? null,
    outcome: input.outcome ?? null,
    resolvedAgent: input.resolvedAgent ?? null,
    intent: input.intent ?? null,
    sourceTools: input.sourceTools ?? [],
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
      recommendationType: null,
      targetCustomerKey: null,
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
