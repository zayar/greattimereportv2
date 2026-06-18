import { firestoreDb } from "../../config/firebase.js";
import { nowIso } from "./safety.js";
import type { AgentFeedbackInput } from "./types.js";

const FEEDBACK_COLLECTION = "gtAgentFeedbackEventsV1";

export async function saveAgentFeedback(input: AgentFeedbackInput & {
  userId: string;
  userEmail?: string;
}) {
  const createdAt = nowIso();

  await firestoreDb().collection(FEEDBACK_COLLECTION).doc().set({
    clinicId: input.clinicId,
    userId: input.userId,
    userEmail: input.userEmail ?? null,
    sessionId: input.sessionId,
    responseId: input.responseId,
    rating: input.rating,
    note: input.note?.slice(0, 1000) ?? null,
    outcome: input.outcome ?? null,
    createdAt,
  });

  return { createdAt };
}
