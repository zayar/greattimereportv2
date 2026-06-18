import { firestoreDb } from "../../config/firebase.js";
import { nowIso, sanitizeError } from "./safety.js";

const LEARNING_RUNS_COLLECTION = "gtAgentLearningRunsV1";
const LOCKS_COLLECTION = "gtAgentLearningLocksV1";

export type AgentLearningJobType =
  | "customer_profiles"
  | "finance_daily_snapshot"
  | "service_practitioner_profiles"
  | "appointment_daily_profile"
  | "feedback_learning"
  | "owner_insight_cards";

function lockId(params: { clinicId: string; jobType: AgentLearningJobType; bucket: string }) {
  return `${encodeURIComponent(params.clinicId)}__${params.jobType}__${params.bucket}`;
}

export async function acquireAgentLearningLock(params: {
  clinicId: string;
  jobType: AgentLearningJobType;
  bucket: string;
  leaseMs?: number;
}) {
  const db = firestoreDb();
  const ref = db.collection(LOCKS_COLLECTION).doc(lockId(params));
  const now = Date.now();
  const expiresAt = new Date(now + (params.leaseMs ?? 10 * 60_000)).toISOString();

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    const existingExpiresAt = typeof data?.expiresAt === "string" ? new Date(data.expiresAt).getTime() : 0;

    if (snapshot.exists && existingExpiresAt > now) {
      return false;
    }

    transaction.set(ref, {
      clinicId: params.clinicId,
      jobType: params.jobType,
      bucket: params.bucket,
      expiresAt,
      updatedAt: nowIso(),
    });

    return true;
  });
}

export async function saveAgentLearningRun(params: {
  clinicId: string;
  clinicCode?: string;
  jobType: AgentLearningJobType;
  bucket: string;
  status: "started" | "completed" | "skipped" | "failed";
  rowCount?: number;
  sourceWatermark?: string | null;
  error?: unknown;
}) {
  const id = `${lockId(params)}__${params.status}__${Date.now().toString(36)}`;

  await firestoreDb().collection(LEARNING_RUNS_COLLECTION).doc(id).set({
    clinicId: params.clinicId,
    clinicCode: params.clinicCode ?? null,
    jobType: params.jobType,
    bucket: params.bucket,
    status: params.status,
    rowCount: params.rowCount ?? 0,
    sourceWatermark: params.sourceWatermark ?? null,
    error: params.error ? sanitizeError(params.error) : null,
    createdAt: nowIso(),
  });
}
