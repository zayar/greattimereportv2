import { firestoreDb } from "../../config/firebase.js";
import type {
  CustomerRelationshipFeedbackOutcome,
  CustomerRelationshipIntent,
  CustomerRelationshipLearningSummary,
  CustomerRelationshipProfile,
  CustomerRelationshipRiskLevel,
  CustomerRelationshipSegment,
} from "../ai/customer-relationship-schemas.js";

const PROFILES_COLLECTION = "customerRelationshipProfiles";
const LEARNING_RUNS_COLLECTION = "customerRelationshipLearningRuns";
const FOLLOW_UPS_COLLECTION = "customerRelationshipFollowUps";
const AGENT_INTERACTIONS_COLLECTION = "customerRelationshipAgentInteractions";

export type CustomerRelationshipProfileSearchInput = {
  clinicId: string;
  segment?: CustomerRelationshipSegment | "";
  riskLevel?: CustomerRelationshipRiskLevel | "";
  search?: string;
  sortBy?: "priorityScore" | "lastVisitDate" | "daysSinceLastVisit" | "lifetimeSpend" | "remainingPackageSessions";
  sortDirection?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

function profileDocId(clinicId: string, customerKey: string) {
  return `${encodeURIComponent(clinicId)}__${customerKey}`;
}

function nowIso() {
  return new Date().toISOString();
}

function profilesCollection() {
  return firestoreDb().collection(PROFILES_COLLECTION);
}

function learningRunsCollection() {
  return firestoreDb().collection(LEARNING_RUNS_COLLECTION);
}

function followUpsCollection() {
  return firestoreDb().collection(FOLLOW_UPS_COLLECTION);
}

function agentInteractionsCollection() {
  return firestoreDb().collection(AGENT_INTERACTIONS_COLLECTION);
}

function isProfile(data: FirebaseFirestore.DocumentData | undefined): data is CustomerRelationshipProfile {
  return Boolean(data?.clinicId && data?.customerKey && data?.customerName);
}

export function normalizeCustomerRelationshipProfile(
  data: CustomerRelationshipProfile,
): CustomerRelationshipProfile {
  const remainingPackageSessions = Number(data.remainingPackageSessions ?? 0);
  const totalPackageSessions = Number(data.totalPackageSessions ?? remainingPackageSessions);

  return {
    ...data,
    customerPhoneMasked: data.customerPhoneMasked ?? "",
    memberId: data.memberId ?? null,
    firstSeenDate: data.firstSeenDate ?? null,
    lastVisitDate: data.lastVisitDate ?? null,
    daysSinceLastVisit: data.daysSinceLastVisit ?? null,
    lastPaymentDate: data.lastPaymentDate ?? null,
    lastPackagePurchaseDate: data.lastPackagePurchaseDate ?? null,
    lastPackageServiceName: data.lastPackageServiceName ?? null,
    lastPackageName: data.lastPackageName ?? null,
    totalVisits: Number(data.totalVisits ?? 0),
    lifetimeSpend: Number(data.lifetimeSpend ?? 0),
    averageSpend: Number(data.averageSpend ?? 0),
    recent90DayVisits: Number(data.recent90DayVisits ?? 0),
    previous90DayVisits: Number(data.previous90DayVisits ?? 0),
    preferredService: data.preferredService ?? null,
    preferredServiceCategory: data.preferredServiceCategory ?? null,
    preferredTherapist: data.preferredTherapist ?? null,
    preferredDayOfWeek: data.preferredDayOfWeek ?? null,
    preferredHour: data.preferredHour ?? null,
    lastService: data.lastService ?? null,
    lastPaymentMethod: data.lastPaymentMethod ?? null,
    packagePurchaseCount: Number(data.packagePurchaseCount ?? 0),
    activePackageCount: Number(data.activePackageCount ?? 0),
    totalPackageSessions,
    usedPackageSessions: Number(data.usedPackageSessions ?? Math.max(0, totalPackageSessions - remainingPackageSessions)),
    remainingPackageSessions,
    packageHoldings: Array.isArray(data.packageHoldings) ? data.packageHoldings : [],
    packagePurchases: Array.isArray(data.packagePurchases) ? data.packagePurchases : [],
    serviceUsageByMonth: Array.isArray(data.serviceUsageByMonth) ? data.serviceUsageByMonth : [],
    packageBoughtNeverCame: Boolean(data.packageBoughtNeverCame),
    packageBoughtButNoUsage: Boolean(data.packageBoughtButNoUsage),
    hasUnusedPackageBalance: Boolean(data.hasUnusedPackageBalance ?? remainingPackageSessions > 0),
    relationshipHealthScore: Number(data.relationshipHealthScore ?? 0),
    rebookingStatus: data.rebookingStatus ?? "unknown",
    segments: Array.isArray(data.segments) ? data.segments : [],
    reasons: Array.isArray(data.reasons) ? data.reasons : [],
    nextBestAction: data.nextBestAction ?? "Review the learned customer profile and record the next follow-up.",
    priorityScore: Number(data.priorityScore ?? 0),
    lastFollowUpAt: data.lastFollowUpAt ?? null,
    lastFollowUpOutcome: data.lastFollowUpOutcome ?? null,
    followUpCount: Number(data.followUpCount ?? 0),
    lastMatchedAt: data.lastMatchedAt ?? null,
    lastMatchedIntent: data.lastMatchedIntent ?? null,
    sourceLookbackDays: Number(data.sourceLookbackDays ?? 365),
  };
}

function compareNullableDate(left: string | null, right: string | null) {
  if (left === right) {
    return 0;
  }
  if (!left) {
    return 1;
  }
  if (!right) {
    return -1;
  }
  return left.localeCompare(right);
}

function normalizeSearch(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

export async function saveCustomerRelationshipProfiles(params: {
  clinicId: string;
  profiles: CustomerRelationshipProfile[];
}) {
  const db = firestoreDb();
  const existingSnapshot = await profilesCollection().where("clinicId", "==", params.clinicId).get();
  const existingProfiles = new Map(
    existingSnapshot.docs
      .map((doc) => doc.data())
      .filter(isProfile)
      .map(normalizeCustomerRelationshipProfile)
      .map((profile) => [profile.customerKey, profile]),
  );
  const batches: FirebaseFirestore.WriteBatch[] = [];
  let currentBatch = db.batch();
  let operationCount = 0;

  params.profiles.forEach((profile) => {
    const existingProfile = existingProfiles.get(profile.customerKey);
    const nextProfile = {
      ...profile,
      lastFollowUpAt: existingProfile?.lastFollowUpAt ?? profile.lastFollowUpAt,
      lastFollowUpOutcome: existingProfile?.lastFollowUpOutcome ?? profile.lastFollowUpOutcome,
      followUpCount: existingProfile?.followUpCount ?? profile.followUpCount,
      lastMatchedAt: existingProfile?.lastMatchedAt ?? profile.lastMatchedAt ?? null,
      lastMatchedIntent: existingProfile?.lastMatchedIntent ?? profile.lastMatchedIntent ?? null,
    };

    currentBatch.set(profilesCollection().doc(profileDocId(params.clinicId, profile.customerKey)), nextProfile, {
      merge: true,
    });
    operationCount += 1;

    if (operationCount >= 450) {
      batches.push(currentBatch);
      currentBatch = db.batch();
      operationCount = 0;
    }
  });

  if (operationCount > 0) {
    batches.push(currentBatch);
  }

  await Promise.all(batches.map((batch) => batch.commit()));
}

export async function saveCustomerRelationshipLearningRun(params: {
  clinicId: string;
  clinicCode: string;
  summary: CustomerRelationshipLearningSummary;
  lookbackDays: number;
}) {
  await learningRunsCollection().doc().set({
    clinicId: params.clinicId,
    clinicCode: params.clinicCode,
    ...params.summary,
    lookbackDays: params.lookbackDays,
    createdAt: params.summary.learnedAt,
  });
}

export async function getLatestCustomerRelationshipLearningRun(clinicId: string) {
  const snapshot = await learningRunsCollection().where("clinicId", "==", clinicId).get();
  const data = snapshot.docs
    .map((doc) => doc.data() as CustomerRelationshipLearningSummary & {
      lookbackDays?: number;
      createdAt?: string;
    })
    .sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""))[0];

  return data
    ? {
        ...data,
        sourceLookbackDays: typeof data.lookbackDays === "number" ? data.lookbackDays : null,
      }
    : null;
}

export async function searchCustomerRelationshipProfiles(input: CustomerRelationshipProfileSearchInput) {
  const snapshot = await profilesCollection().where("clinicId", "==", input.clinicId).get();
  const search = normalizeSearch(input.search);
  const sortBy = input.sortBy ?? "priorityScore";
  const direction = input.sortDirection ?? "desc";

  const filtered = snapshot.docs
    .map((doc) => doc.data())
    .filter(isProfile)
    .map(normalizeCustomerRelationshipProfile)
    .filter((profile) => (input.segment ? profile.segments.includes(input.segment) : true))
    .filter((profile) => (input.riskLevel ? profile.riskLevel === input.riskLevel : true))
    .filter((profile) => {
      if (!search) {
        return true;
      }
      return (
        profile.customerName.toLowerCase().includes(search) ||
        profile.customerPhoneMasked.toLowerCase().includes(search) ||
        (profile.memberId ?? "").toLowerCase().includes(search)
      );
    });

  filtered.sort((left, right) => {
    let result = 0;

    if (sortBy === "lastVisitDate") {
      result = compareNullableDate(left.lastVisitDate, right.lastVisitDate);
    } else {
      const leftValue = left[sortBy] ?? 0;
      const rightValue = right[sortBy] ?? 0;
      result = Number(leftValue) - Number(rightValue);
    }

    return direction === "asc" ? result : -result;
  });

  const offset = input.offset ?? 0;
  const limit = input.limit ?? 25;

  return {
    rows: filtered.slice(offset, offset + limit),
    totalCount: filtered.length,
  };
}

export async function searchCustomerRelationshipProfilesBounded(input: CustomerRelationshipProfileSearchInput) {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  let query: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = profilesCollection().where(
    "clinicId",
    "==",
    input.clinicId,
  );

  if (input.riskLevel) {
    query = query.where("riskLevel", "==", input.riskLevel);
  }

  if (input.segment) {
    query = query.where("segments", "array-contains", input.segment);
  }

  const snapshot = await query.limit(limit * 2).get();
  const search = normalizeSearch(input.search);
  const sortBy = input.sortBy ?? "priorityScore";
  const direction = input.sortDirection ?? "desc";

  const rows = snapshot.docs
    .map((doc) => doc.data())
    .filter(isProfile)
    .map(normalizeCustomerRelationshipProfile)
    .filter((profile) => {
      if (!search) {
        return true;
      }

      return (
        profile.customerName.toLowerCase().includes(search) ||
        profile.customerPhoneMasked.toLowerCase().includes(search) ||
        (profile.memberId ?? "").toLowerCase().includes(search)
      );
    });

  rows.sort((left, right) => {
    let result = 0;

    if (sortBy === "lastVisitDate") {
      result = compareNullableDate(left.lastVisitDate, right.lastVisitDate);
    } else {
      result = Number(left[sortBy] ?? 0) - Number(right[sortBy] ?? 0);
    }

    return direction === "asc" ? result : -result;
  });

  const offset = input.offset ?? 0;

  return {
    rows: rows.slice(offset, offset + limit),
    totalCount: rows.length,
    bounded: true,
  };
}

export async function getCustomerRelationshipProfileByKey(params: {
  clinicId: string;
  customerKey: string;
}) {
  const snapshot = await profilesCollection().doc(profileDocId(params.clinicId, params.customerKey)).get();
  const data = snapshot.data();
  return isProfile(data) ? normalizeCustomerRelationshipProfile(data) : null;
}

export async function markCustomerRelationshipProfilesMatched(params: {
  clinicId: string;
  customerKeys: string[];
  intent: CustomerRelationshipIntent;
  matchedAt?: string;
}) {
  if (params.customerKeys.length === 0) {
    return;
  }

  const matchedAt = params.matchedAt ?? nowIso();
  const db = firestoreDb();
  const batch = db.batch();

  params.customerKeys.slice(0, 50).forEach((customerKey) => {
    batch.set(
      profilesCollection().doc(profileDocId(params.clinicId, customerKey)),
      {
        lastMatchedAt: matchedAt,
        lastMatchedIntent: params.intent,
      },
      { merge: true },
    );
  });

  await batch.commit();
}

export async function saveCustomerRelationshipAgentInteraction(params: {
  clinicId: string;
  clinicCode: string;
  question: string;
  detectedIntent: CustomerRelationshipIntent;
  matchedCount: number;
  createdAt?: string;
}) {
  await agentInteractionsCollection().doc().set({
    ...params,
    createdAt: params.createdAt ?? nowIso(),
  });
}

export async function saveCustomerRelationshipFollowUp(params: {
  clinicId: string;
  clinicCode: string;
  customerKey: string;
  outcome: CustomerRelationshipFeedbackOutcome;
  note?: string | null;
}) {
  const profile = await getCustomerRelationshipProfileByKey({
    clinicId: params.clinicId,
    customerKey: params.customerKey,
  });
  const timestamp = nowIso();
  const nextFollowUpCount = (profile?.followUpCount ?? 0) + 1;
  const currentPriority = profile?.priorityScore ?? 0;
  const priorityAdjustment =
    params.outcome === "booked" ? -12 : params.outcome === "no_reply" ? 4 : params.outcome === "wrong_number" ? -8 : 0;

  await Promise.all([
    followUpsCollection().doc().set({
      clinicId: params.clinicId,
      clinicCode: params.clinicCode,
      customerKey: params.customerKey,
      outcome: params.outcome,
      note: params.note?.trim() || null,
      createdAt: timestamp,
    }),
    profilesCollection().doc(profileDocId(params.clinicId, params.customerKey)).set(
      {
        lastFollowUpAt: timestamp,
        lastFollowUpOutcome: params.outcome,
        followUpCount: nextFollowUpCount,
        priorityScore: Math.max(0, Math.min(100, currentPriority + priorityAdjustment)),
      },
      { merge: true },
    ),
  ]);
}
