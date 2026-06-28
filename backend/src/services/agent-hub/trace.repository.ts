import { firestoreDb } from "../../config/firebase.js";
import type { AgentRunTrace } from "./types.js";

const RUN_TRACES_COLLECTION = "gtAgentRunTraces";
const LEGACY_RUN_TRACES_COLLECTION = "gtAgentRunTracesV1";
const RUN_TRACE_COLLECTIONS = [RUN_TRACES_COLLECTION, LEGACY_RUN_TRACES_COLLECTION] as const;

export async function saveAgentRunTrace(trace: AgentRunTrace) {
  const db = firestoreDb();
  const writes = await Promise.allSettled(
    RUN_TRACE_COLLECTIONS.map((collectionName) =>
      db.collection(collectionName).doc(trace.responseId).set(trace, { merge: true }),
    ),
  );

  if (writes.every((result) => result.status === "rejected")) {
    throw writes[0].reason;
  }
}

function isAgentRunTrace(data: FirebaseFirestore.DocumentData | undefined): data is AgentRunTrace {
  return Boolean(data?.clinicId && data?.requestId && data?.responseId && data?.intent && data?.createdAt);
}

async function listRecentAgentRunTracesFromCollection(params: {
  collectionName: string;
  clinicId?: string;
  since: Date;
  limit: number;
}) {
  const db = firestoreDb();
  const sinceMs = params.since.getTime();
  const baseCollection = db.collection(params.collectionName);
  const queries: Array<() => Promise<FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>>> = [];

  if (params.clinicId) {
    queries.push(() =>
      baseCollection
        .where("clinicId", "==", params.clinicId)
        .orderBy("createdAt", "desc")
        .limit(params.limit)
        .get(),
    );
    queries.push(() => baseCollection.where("clinicId", "==", params.clinicId).limit(params.limit).get());
  } else {
    queries.push(() => baseCollection.orderBy("createdAt", "desc").limit(params.limit).get());
    queries.push(() => baseCollection.limit(params.limit).get());
  }

  for (const query of queries) {
    try {
      const snapshot = await query();
      return snapshot.docs
        .map((doc) => doc.data())
        .filter(isAgentRunTrace)
        .filter((trace) => new Date(trace.createdAt).getTime() >= sinceMs);
    } catch {
      // Try the less index-sensitive fallback query.
    }
  }

  return [];
}

export async function listRecentAgentRunTraces(params: {
  clinicId?: string;
  since: Date;
  limit?: number;
}) {
  const limit = Math.min(Math.max(params.limit ?? 500, 1), 2_000);
  const rows = await Promise.all(
    RUN_TRACE_COLLECTIONS.map((collectionName) =>
      listRecentAgentRunTracesFromCollection({
        collectionName,
        clinicId: params.clinicId,
        since: params.since,
        limit,
      }),
    ),
  );
  const byResponseId = new Map<string, AgentRunTrace>();

  rows.flat().forEach((trace) => {
    byResponseId.set(trace.responseId, trace);
  });

  return [...byResponseId.values()]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, limit);
}
