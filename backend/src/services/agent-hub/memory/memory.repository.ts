import { createHash } from "node:crypto";
import { firestoreDb } from "../../../config/firebase.js";
import { evaluateMemoryCandidate } from "./memory-policy.js";
import {
  GT_AGENT_CLINIC_MEMORIES_COLLECTION,
  GT_AGENT_FACT_SNAPSHOTS_COLLECTION,
  GT_AGENT_INSIGHT_CARDS_COLLECTION,
  GT_AGENT_RECOMMENDATION_OUTCOMES_COLLECTION,
  GT_AGENT_SESSION_SUMMARIES_COLLECTION,
  GT_AGENT_USER_PREFERENCES_COLLECTION,
  type GtAgentFactSnapshot,
  type GtAgentInsightCard,
  type GtAgentInsightCardStatus,
  type GtAgentInsightCardType,
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

const OPEN_INSIGHT_CARD_STATUSES = new Set<GtAgentInsightCardStatus>(["new", "viewed", "accepted", "remind_later"]);
const VALID_INSIGHT_CARD_STATUSES = new Set<GtAgentInsightCardStatus>([
  "new",
  "viewed",
  "dismissed",
  "accepted",
  "done",
  "remind_later",
]);
const VALID_INSIGHT_CARD_TYPES = new Set<GtAgentInsightCardType>([
  "unused_package_recovery",
  "inactive_high_value_customer",
  "treatment_due",
  "rising_cancellations_no_shows",
  "service_sales_high_usage_low",
  "declining_service_usage",
  "practitioner_capacity_gap",
  "collections_below_sales",
]);

function stableFactSnapshotId(prefix: string, parts: string[]) {
  return `${prefix}_${createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24)}`;
}

function latestFactSnapshotId(params: { clinicId: string; snapshotType: string }) {
  return stableFactSnapshotId("fact_latest", [params.clinicId, params.snapshotType]);
}

const TERMINAL_RECOMMENDATION_STATES = new Set<GtAgentRecommendationOutcome["state"]>([
  "booked",
  "paid",
  "visited",
  "dismissed",
  "not_interested",
  "failed",
]);

const RECOMMENDATION_STATE_RANK: Record<GtAgentRecommendationOutcome["state"], number> = {
  shown: 0,
  accepted: 1,
  contacted: 2,
  no_reply: 2,
  remind_later: 2,
  replied: 3,
  booked: 4,
  paid: 4,
  visited: 4,
  dismissed: 4,
  not_interested: 4,
  failed: 4,
};

export function selectRecommendationOutcomeState(params: {
  existing?: GtAgentRecommendationOutcome["state"] | null;
  incoming: GtAgentRecommendationOutcome["state"];
}): GtAgentRecommendationOutcome["state"] {
  if (!params.existing) {
    return params.incoming;
  }

  if (TERMINAL_RECOMMENDATION_STATES.has(params.existing)) {
    return params.existing;
  }

  if (params.incoming === "shown") {
    return params.existing;
  }

  return RECOMMENDATION_STATE_RANK[params.incoming] >= RECOMMENDATION_STATE_RANK[params.existing]
    ? params.incoming
    : params.existing;
}

function isMemoryRecord(data: FirebaseFirestore.DocumentData | undefined): data is GtAgentMemoryRecord {
  return Boolean(data?.id && data?.clinicId && data?.memoryType && data?.content);
}

function sessionSummaryId(params: { clinicId: string; userId: string; sessionId: string }) {
  return `${encodeURIComponent(params.clinicId)}__${encodeURIComponent(params.userId)}__${encodeURIComponent(params.sessionId)}`;
}

export async function saveMemoryRecord(memory: GtAgentMemoryRecord) {
  const collection = memory.userId ? userPreferenceCollection() : clinicMemoryCollection();
  const db = firestoreDb();
  const ref = collection.doc(memory.id);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const snapshotData = snapshot.data();
    const existing = isMemoryRecord(snapshotData) ? snapshotData : null;
    const merged = mergeMemoryRecords(existing, memory);
    const decision = evaluateMemoryCandidate({
      clinicId: merged.clinicId,
      userId: merged.userId,
      entityType: merged.entityType,
      entityId: merged.entityId,
      agentId: merged.agentId,
      intent: merged.intent,
      memoryType: merged.memoryType,
      content: merged.content,
      preferenceKey: merged.preferenceKey,
      preferenceValue: merged.preferenceValue,
      source: merged.source,
      confidence: merged.confidence,
      evidenceCount: merged.evidenceCount,
      sourceEventIds: merged.sourceEventIds,
      sourceSessionIds: merged.sourceSessionIds,
      observedAt: merged.lastObservedAt ?? undefined,
    });

    if (decision.accepted) {
      merged.status = decision.status;
      merged.confidence = Math.max(merged.confidence, decision.confidence);
    }

    if (memory.source === "explicit_user" && memory.preferenceKey) {
      const conflictQuery = collection
        .where("clinicId", "==", memory.clinicId)
        .where("preferenceKey", "==", memory.preferenceKey)
        .where("status", "==", "active")
        .limit(50);
      const conflicts = await transaction.get(conflictQuery);

      conflicts.docs
        .map((doc) => ({ ref: doc.ref, data: doc.data() }))
        .filter((doc) => doc.ref.id !== memory.id)
        .filter((doc) => isMemoryRecord(doc.data))
        .filter((doc) => sameMemoryScope(doc.data as GtAgentMemoryRecord, memory))
        .filter((doc) => stableValue(doc.data.preferenceValue) !== stableValue(memory.preferenceValue))
        .forEach((doc) => {
          transaction.set(
            doc.ref,
            {
              status: "superseded",
              supersededByMemoryId: memory.id,
              updatedAt: memory.updatedAt,
            },
            { merge: true },
          );
        });
    }

    transaction.set(ref, merged);
    return merged;
  });
}

function stableValue(value: unknown) {
  if (Array.isArray(value)) {
    return JSON.stringify([...value].sort());
  }

  return value == null ? "" : JSON.stringify(value);
}

function uniqueBounded(values: Array<string | null | undefined>, max: number) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].slice(-max);
}

function latestIso(left: string | null | undefined, right: string | null | undefined) {
  if (!left) {
    return right ?? null;
  }
  if (!right) {
    return left;
  }

  return new Date(right).getTime() > new Date(left).getTime() ? right : left;
}

function sameMemoryScope(left: GtAgentMemoryRecord, right: GtAgentMemoryRecord) {
  return (
    (left.userId ?? null) === (right.userId ?? null) &&
    (left.agentId ?? null) === (right.agentId ?? null) &&
    (left.intent ?? null) === (right.intent ?? null) &&
    (left.entityType ?? null) === (right.entityType ?? null) &&
    (left.entityId ?? null) === (right.entityId ?? null)
  );
}

function mergeMemoryRecords(existing: GtAgentMemoryRecord | null, incoming: GtAgentMemoryRecord): GtAgentMemoryRecord {
  if (!existing) {
    return {
      ...incoming,
      sourceEventIds: uniqueBounded(incoming.sourceEventIds, 50),
      sourceSessionIds: uniqueBounded(incoming.sourceSessionIds ?? [], 50),
    };
  }

  const existingEventIds = new Set(existing.sourceEventIds ?? []);
  const incomingEventIds = incoming.sourceEventIds ?? [];
  const newEventCount = incomingEventIds.length
    ? incomingEventIds.filter((eventId) => !existingEventIds.has(eventId)).length
    : incoming.evidenceCount;
  const sourceEventIds = uniqueBounded([...(existing.sourceEventIds ?? []), ...incomingEventIds], 50);
  const sourceSessionIds = uniqueBounded([...(existing.sourceSessionIds ?? []), ...(incoming.sourceSessionIds ?? [])], 50);
  const evidenceCount = Math.max(existing.evidenceCount + newEventCount, sourceEventIds.length, incoming.evidenceCount);
  const source =
    existing.source === "explicit_user" || incoming.source === "explicit_user"
      ? "explicit_user"
      : incoming.source === "verified_outcome"
        ? "verified_outcome"
        : existing.source;

  return {
    ...existing,
    content: incoming.content || existing.content,
    preferenceKey: incoming.preferenceKey ?? existing.preferenceKey ?? null,
    preferenceValue: incoming.preferenceValue ?? existing.preferenceValue ?? null,
    source,
    status: incoming.source === "explicit_user" ? incoming.status : existing.status,
    confidence: Math.max(existing.confidence, incoming.confidence),
    evidenceCount,
    sourceEventIds,
    sourceSessionIds,
    createdAt: existing.createdAt,
    updatedAt: incoming.updatedAt,
    lastObservedAt: latestIso(existing.lastObservedAt ?? existing.updatedAt, incoming.lastObservedAt ?? incoming.updatedAt),
    validFrom: existing.validFrom ?? incoming.validFrom,
    validUntil: incoming.source === "explicit_user" ? null : latestIso(existing.validUntil, incoming.validUntil),
    supersededByMemoryId: existing.supersededByMemoryId ?? null,
  };
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
  const db = firestoreDb();
  const ref = recommendationOutcomeCollection().doc(outcome.id);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const existing = snapshot.data() as GtAgentRecommendationOutcome | undefined;
    const sourceTools = uniqueBounded([...(existing?.sourceTools ?? []), ...(outcome.sourceTools ?? [])], 50);
    const sourceEvidenceRefs = uniqueBounded(
      [...(existing?.sourceEvidenceRefs ?? []), ...(outcome.sourceEvidenceRefs ?? [])],
      50,
    );
    const state = selectRecommendationOutcomeState({
      existing: existing?.state,
      incoming: outcome.state,
    });
    const merged: GtAgentRecommendationOutcome = {
      ...outcome,
      recommendationType: outcome.recommendationType ?? existing?.recommendationType ?? null,
      opportunityKey: outcome.opportunityKey ?? existing?.opportunityKey ?? null,
      targetCustomerKey: outcome.targetCustomerKey ?? existing?.targetCustomerKey ?? null,
      sourceTools,
      sourceEvidenceRefs,
      state,
      shownAt: existing?.shownAt ?? outcome.shownAt ?? (outcome.state === "shown" ? outcome.updatedAt : null),
      acceptedAt: existing?.acceptedAt ?? outcome.acceptedAt ?? (outcome.state === "accepted" ? outcome.updatedAt : null),
      contactedAt: existing?.contactedAt ?? outcome.contactedAt ?? (outcome.state === "contacted" ? outcome.updatedAt : null),
      observedAt: existing?.observedAt ?? outcome.observedAt ?? null,
      verificationWindowDays: outcome.verificationWindowDays ?? existing?.verificationWindowDays ?? 30,
      createdAt: existing?.createdAt ?? outcome.createdAt,
      updatedAt: outcome.updatedAt,
    };

    transaction.set(ref, merged);
    return merged;
  });
}

function isRecommendationOutcome(data: FirebaseFirestore.DocumentData | undefined): data is GtAgentRecommendationOutcome {
  return Boolean(data?.id && data?.recommendationId && data?.clinicId && data?.state && data?.updatedAt);
}

export async function listRecentRecommendationOutcomes(params: {
  clinicId?: string;
  since: Date;
  limit?: number;
}) {
  const limit = Math.min(Math.max(params.limit ?? 500, 1), 2_000);
  const sinceMs = params.since.getTime();
  const collection = recommendationOutcomeCollection();
  const queries: Array<() => Promise<FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>>> = [];

  if (params.clinicId) {
    queries.push(() =>
      collection
        .where("clinicId", "==", params.clinicId)
        .orderBy("updatedAt", "desc")
        .limit(limit)
        .get(),
    );
    queries.push(() => collection.where("clinicId", "==", params.clinicId).limit(limit).get());
  } else {
    queries.push(() => collection.orderBy("updatedAt", "desc").limit(limit).get());
    queries.push(() => collection.limit(limit).get());
  }

  for (const query of queries) {
    try {
      const snapshot = await query();
      return snapshot.docs
        .map((doc) => doc.data())
        .filter(isRecommendationOutcome)
        .filter((outcome) => new Date(outcome.updatedAt).getTime() >= sinceMs)
        .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
        .slice(0, limit);
    } catch {
      // Try the less index-sensitive fallback query.
    }
  }

  return [];
}

export async function saveInsightCard(card: GtAgentInsightCard) {
  await insightCardCollection().doc(card.id).set(card, { merge: true });
}

function isInsightCard(data: FirebaseFirestore.DocumentData | undefined): data is GtAgentInsightCard {
  return Boolean(data?.id && data?.clinicId && data?.type && data?.status && data?.checkedAt);
}

export async function listRecentInsightCards(params: {
  clinicId?: string;
  since: Date;
  limit?: number;
}) {
  const limit = Math.min(Math.max(params.limit ?? 500, 1), 2_000);
  const sinceMs = params.since.getTime();
  const collection = insightCardCollection();
  const queries: Array<() => Promise<FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>>> = [];

  if (params.clinicId) {
    queries.push(() =>
      collection
        .where("clinicId", "==", params.clinicId)
        .orderBy("checkedAt", "desc")
        .limit(limit)
        .get(),
    );
    queries.push(() => collection.where("clinicId", "==", params.clinicId).limit(limit).get());
  } else {
    queries.push(() => collection.orderBy("checkedAt", "desc").limit(limit).get());
    queries.push(() => collection.limit(limit).get());
  }

  for (const query of queries) {
    try {
      const snapshot = await query();
      return snapshot.docs
        .map((doc) => doc.data())
        .filter(isInsightCard)
        .filter((card) => new Date(card.checkedAt).getTime() >= sinceMs)
        .sort((left, right) => new Date(right.checkedAt).getTime() - new Date(left.checkedAt).getTime())
        .slice(0, limit);
    } catch {
      // Try the less index-sensitive fallback query.
    }
  }

  return [];
}

export async function getInsightCardById(cardId: string) {
  const snapshot = await insightCardCollection().doc(cardId).get();
  return (snapshot.data() as GtAgentInsightCard | undefined) ?? null;
}

export async function saveFactSnapshot(snapshot: GtAgentFactSnapshot) {
  await factSnapshotCollection().doc(snapshot.id).set(snapshot, { merge: true });
}

function isFactSnapshot(data: FirebaseFirestore.DocumentData | undefined): data is GtAgentFactSnapshot {
  return Boolean(data?.id && data?.clinicId && data?.snapshotType && data?.checkedAt);
}

export async function listRecentFactSnapshots(params: {
  clinicId?: string;
  since: Date;
  limit?: number;
}) {
  const limit = Math.min(Math.max(params.limit ?? 500, 1), 2_000);
  const sinceMs = params.since.getTime();
  const collection = factSnapshotCollection();
  const queries: Array<() => Promise<FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>>> = [];

  if (params.clinicId) {
    queries.push(() =>
      collection
        .where("clinicId", "==", params.clinicId)
        .orderBy("checkedAt", "desc")
        .limit(limit)
        .get(),
    );
    queries.push(() => collection.where("clinicId", "==", params.clinicId).limit(limit).get());
  } else {
    queries.push(() => collection.orderBy("checkedAt", "desc").limit(limit).get());
    queries.push(() => collection.limit(limit).get());
  }

  for (const query of queries) {
    try {
      const snapshot = await query();
      return snapshot.docs
        .map((doc) => doc.data())
        .filter(isFactSnapshot)
        .filter((factSnapshot) => new Date(factSnapshot.checkedAt).getTime() >= sinceMs)
        .sort((left, right) => new Date(right.checkedAt).getTime() - new Date(left.checkedAt).getTime())
        .slice(0, limit);
    } catch {
      // Try the less index-sensitive fallback query.
    }
  }

  return [];
}

export async function saveLatestFactSnapshot(snapshot: GtAgentFactSnapshot) {
  await factSnapshotCollection()
    .doc(latestFactSnapshotId(snapshot))
    .set(
      {
        ...snapshot,
        id: latestFactSnapshotId(snapshot),
        bucket: "latest",
      },
      { merge: true },
    );
}

export async function getLatestFactSnapshot(params: {
  clinicId: string;
  snapshotType: string;
  includeExpired?: boolean;
}) {
  const snapshot = await factSnapshotCollection().doc(latestFactSnapshotId(params)).get();
  const data = snapshot.data() as GtAgentFactSnapshot | undefined;

  if (!data || data.clinicId !== params.clinicId || data.snapshotType !== params.snapshotType) {
    return null;
  }

  if (!params.includeExpired && data.expiresAt && new Date(data.expiresAt).getTime() <= Date.now()) {
    return null;
  }

  return data;
}

export async function getFactSnapshotForPeriod(params: {
  clinicId: string;
  snapshotType: string;
  fromDate: string;
  toDate: string;
  includeExpired?: boolean;
  limit?: number;
}) {
  const limit = Math.min(Math.max(params.limit ?? 5, 1), 20);
  const snapshot = await factSnapshotCollection()
    .where("clinicId", "==", params.clinicId)
    .where("snapshotType", "==", params.snapshotType)
    .where("dateRange.fromDate", "==", params.fromDate)
    .where("dateRange.toDate", "==", params.toDate)
    .limit(limit)
    .get();
  const now = Date.now();

  return snapshot.docs
    .map((doc) => doc.data() as GtAgentFactSnapshot)
    .filter((data) => data.clinicId === params.clinicId && data.snapshotType === params.snapshotType)
    .filter((data) => params.includeExpired || !data.expiresAt || new Date(data.expiresAt).getTime() > now)
    .sort((left, right) => new Date(right.checkedAt).getTime() - new Date(left.checkedAt).getTime())[0] ?? null;
}

export async function listInsightCards(params: {
  clinicId: string;
  status?: string;
  type?: string;
  limit?: number;
}) {
  const limit = Math.min(Math.max(params.limit ?? 10, 1), 100);
  const status = params.status && VALID_INSIGHT_CARD_STATUSES.has(params.status as GtAgentInsightCardStatus)
    ? (params.status as GtAgentInsightCardStatus)
    : null;
  const type = params.type && VALID_INSIGHT_CARD_TYPES.has(params.type as GtAgentInsightCardType)
    ? (params.type as GtAgentInsightCardType)
    : null;
  let query: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = insightCardCollection()
    .where("clinicId", "==", params.clinicId)
    .limit(limit);

  if (status) {
    query = query.where("status", "==", status);
  }

  if (type) {
    query = query.where("type", "==", type);
  }

  const snapshot = await query.get();
  const now = Date.now();

  return snapshot.docs
    .map((doc) => doc.data() as GtAgentInsightCard)
    .filter((card) => card.clinicId === params.clinicId)
    .filter((card) => status || OPEN_INSIGHT_CARD_STATUSES.has(card.status))
    .filter((card) => !type || card.type === type)
    .filter((card) => !card.expiresAt || new Date(card.expiresAt).getTime() > now)
    .sort((left, right) => {
      if (right.personalizedPriorityScore !== left.personalizedPriorityScore) {
        return right.personalizedPriorityScore - left.personalizedPriorityScore;
      }

      return new Date(right.checkedAt).getTime() - new Date(left.checkedAt).getTime();
    })
    .slice(0, limit);
}

export async function updateInsightCardStatus(params: {
  clinicId: string;
  cardId: string;
  status: GtAgentInsightCardStatus;
  updatedAt?: string;
}) {
  const existing = await getInsightCardById(params.cardId);
  if (!existing || existing.clinicId !== params.clinicId) {
    return null;
  }

  const updatedAt = params.updatedAt ?? new Date().toISOString();
  const updated = {
    ...existing,
    status: params.status,
    updatedAt,
  };

  await insightCardCollection().doc(params.cardId).set(updated, { merge: true });
  return updated;
}

export async function countActiveMemories(params: { clinicId: string }) {
  const [userSnapshot, clinicSnapshot] = await Promise.all([
    userPreferenceCollection().where("clinicId", "==", params.clinicId).where("status", "==", "active").get(),
    clinicMemoryCollection().where("clinicId", "==", params.clinicId).where("status", "==", "active").get(),
  ]);

  return userSnapshot.size + clinicSnapshot.size;
}

export async function archiveExpiredMemories(params: {
  clinicId: string;
  now?: Date;
  limit?: number;
}) {
  const now = params.now ?? new Date();
  const limit = Math.min(Math.max(params.limit ?? 200, 1), 400);
  const [userSnapshot, clinicSnapshot] = await Promise.all([
    userPreferenceCollection().where("clinicId", "==", params.clinicId).limit(limit).get(),
    clinicMemoryCollection().where("clinicId", "==", params.clinicId).limit(limit).get(),
  ]);
  const expired = [...userSnapshot.docs, ...clinicSnapshot.docs].filter((doc) => {
    const memory = doc.data() as GtAgentMemoryRecord;
    if (!isMemoryRecord(memory) || !memory.validUntil || ["archived", "superseded"].includes(memory.status)) {
      return false;
    }

    return new Date(memory.validUntil).getTime() <= now.getTime();
  });

  if (expired.length === 0) {
    return 0;
  }

  const db = firestoreDb();
  const batch = db.batch();
  expired.slice(0, 450).forEach((doc) => {
    batch.set(doc.ref, { status: "archived", updatedAt: now.toISOString() }, { merge: true });
  });
  await batch.commit();
  return Math.min(expired.length, 450);
}
