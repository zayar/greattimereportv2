import { firestoreDb } from "../../config/firebase.js";
import type { AgentRunTrace } from "./types.js";

const RUN_TRACES_COLLECTION = "gtAgentRunTracesV1";

export async function saveAgentRunTrace(trace: AgentRunTrace) {
  await firestoreDb().collection(RUN_TRACES_COLLECTION).doc(trace.responseId).set(trace, { merge: true });
}
