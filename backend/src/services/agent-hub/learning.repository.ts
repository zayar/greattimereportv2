import { firestoreDb } from "../../config/firebase.js";
import { nowIso, sanitizeError } from "./safety.js";
import {
  GT_AGENT_LEARNING_SCHEDULES_COLLECTION,
  GT_AGENT_LEARNING_WATERMARKS_COLLECTION,
} from "./memory/memory-types.js";

const LEARNING_RUNS_COLLECTION = "gtAgentLearningRunsV1";
const LOCKS_COLLECTION = "gtAgentLearningLocksV1";

export type AgentLearningJobType =
  | "customer_profiles"
  | "finance_daily_snapshot"
  | "service_profiles"
  | "practitioner_profiles"
  | "service_practitioner_profiles"
  | "appointment_operational_snapshot"
  | "appointment_daily_profile"
  | "feedback_learning"
  | "recommendation_outcome_observer"
  | "owner_insight_cards"
  | "weekly_business_review"
  | "memory_maintenance";

export type AgentLearningRunCounts = {
  scanned: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
};

export type AgentLearningRunRecord = {
  clinicId: string;
  clinicCode?: string | null;
  jobType: AgentLearningJobType;
  bucket: string;
  status: "started" | "completed" | "skipped" | "failed";
  rowCount: number;
  counts: AgentLearningRunCounts;
  sourceWatermark?: string | null;
  nextExpectedRunAt?: string | null;
  error?: string | null;
  createdAt: string;
};

export type AgentLearningScheduleRecord = {
  id: string;
  clinicId: string;
  clinicCode: string;
  timezone: string;
  enabled: boolean;
  enabledJobTypes: AgentLearningJobType[];
  cadenceOverrides?: Partial<Record<AgentLearningJobType, string>>;
  operatingDays?: number[];
  localOpeningTime?: string | null;
  localClosingTime?: string | null;
  operationalSnapshotIntervalMinutes?: 15 | 30 | 60;
  offHoursOperationalSnapshotEnabled?: boolean;
  updatedAt?: string;
  updatedBy?: string | null;
};

export type AgentLearningWatermarkRecord = {
  sourceWatermark: string | null;
  completedBucket: string | null;
};

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
  const expiresAt = new Date(now + (params.leaseMs ?? 60 * 60_000)).toISOString();

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
  counts?: Partial<AgentLearningRunCounts>;
  sourceWatermark?: string | null;
  nextExpectedRunAt?: string | null;
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
    counts: {
      scanned: params.counts?.scanned ?? params.rowCount ?? 0,
      created: params.counts?.created ?? 0,
      updated: params.counts?.updated ?? 0,
      skipped: params.counts?.skipped ?? 0,
      failed: params.counts?.failed ?? (params.status === "failed" ? 1 : 0),
    },
    sourceWatermark: params.sourceWatermark ?? null,
    nextExpectedRunAt: params.nextExpectedRunAt ?? null,
    error: params.error ? sanitizeError(params.error) : null,
    createdAt: nowIso(),
  });
}

function isAgentLearningRunRecord(data: FirebaseFirestore.DocumentData | undefined): data is AgentLearningRunRecord {
  return Boolean(data?.clinicId && data?.jobType && data?.status && data?.createdAt);
}

export async function listRecentAgentLearningRuns(params: {
  clinicId?: string;
  since: Date;
  limit?: number;
}) {
  const db = firestoreDb();
  const limit = Math.min(Math.max(params.limit ?? 500, 1), 2_000);
  const sinceMs = params.since.getTime();
  const collection = db.collection(LEARNING_RUNS_COLLECTION);
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
        .map((doc) => doc.data())
        .filter(isAgentLearningRunRecord)
        .filter((run) => new Date(run.createdAt).getTime() >= sinceMs)
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
        .slice(0, limit);
    } catch {
      // Try the less index-sensitive fallback query.
    }
  }

  return [];
}

function watermarkId(params: { clinicId: string; jobType: AgentLearningJobType }) {
  return `${encodeURIComponent(params.clinicId)}__${params.jobType}`;
}

export async function getAgentLearningWatermark(params: {
  clinicId: string;
  jobType: AgentLearningJobType;
}): Promise<AgentLearningWatermarkRecord> {
  const snapshot = await firestoreDb()
    .collection(GT_AGENT_LEARNING_WATERMARKS_COLLECTION)
    .doc(watermarkId(params))
    .get();
  const data = snapshot.data();

  return {
    sourceWatermark: typeof data?.sourceWatermark === "string" ? data.sourceWatermark : null,
    completedBucket:
      typeof data?.completedBucket === "string"
        ? data.completedBucket
        : typeof data?.bucket === "string"
          ? data.bucket
          : null,
  };
}

export async function saveAgentLearningWatermark(params: {
  clinicId: string;
  jobType: AgentLearningJobType;
  sourceWatermark: string;
  bucket: string;
}) {
  await firestoreDb().collection(GT_AGENT_LEARNING_WATERMARKS_COLLECTION).doc(watermarkId(params)).set(
    {
      clinicId: params.clinicId,
      jobType: params.jobType,
      sourceWatermark: params.sourceWatermark,
      completedBucket: params.bucket,
      bucket: params.bucket,
      updatedAt: nowIso(),
    },
    { merge: true },
  );
}

function isScheduleRecord(data: FirebaseFirestore.DocumentData | undefined): data is AgentLearningScheduleRecord {
  return Boolean(data?.clinicId && data?.clinicCode && data?.timezone && Array.isArray(data?.enabledJobTypes));
}

export async function listAgentLearningSchedules(params?: {
  clinicIds?: string[];
  limit?: number;
}) {
  const snapshot = await firestoreDb()
    .collection(GT_AGENT_LEARNING_SCHEDULES_COLLECTION)
    .limit(Math.min(Math.max(params?.limit ?? 200, 1), 500))
    .get();
  const clinicFilter = new Set(params?.clinicIds ?? []);

  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter(isScheduleRecord)
    .filter((schedule) => schedule.enabled)
    .filter((schedule) => (clinicFilter.size ? clinicFilter.has(schedule.clinicId) : true));
}
