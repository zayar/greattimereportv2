import type { AgentDataStatus, GreatTimeAgentId, GreatTimeAgentRecommendation } from "../types.js";

export const GT_AGENT_SESSION_SUMMARIES_COLLECTION = "gtAgentSessionSummariesV2";
export const GT_AGENT_USER_PREFERENCES_COLLECTION = "gtAgentUserPreferencesV2";
export const GT_AGENT_CLINIC_MEMORIES_COLLECTION = "gtAgentClinicMemoriesV2";
export const GT_AGENT_RECOMMENDATION_OUTCOMES_COLLECTION = "gtAgentRecommendationOutcomesV2";
export const GT_AGENT_INSIGHT_CARDS_COLLECTION = "gtAgentInsightCardsV2";
export const GT_AGENT_FACT_SNAPSHOTS_COLLECTION = "gtAgentFactSnapshotsV2";
export const GT_AGENT_LEARNING_WATERMARKS_COLLECTION = "gtAgentLearningWatermarksV2";
export const GT_AGENT_LEARNING_SCHEDULES_COLLECTION = "gtAgentLearningSchedulesV1";

export type GtAgentMemoryStatus = "candidate" | "active" | "superseded" | "archived";
export type GtAgentMemorySource = "explicit_user" | "feedback" | "system_observed" | "verified_outcome";
export type GtAgentMemoryType =
  | "response_style"
  | "language_preference"
  | "priority_preference"
  | "clinic_pattern"
  | "entity_pattern"
  | "data_quality"
  | "ranking_signal";

export type GtAgentMemoryEntityType = "customer" | "service" | "practitioner" | "appointment" | "clinic" | "agent";

export type GtAgentMemoryRecord = {
  id: string;
  clinicId: string;
  userId?: string | null;
  entityType?: GtAgentMemoryEntityType | null;
  entityId?: string | null;
  agentId?: GreatTimeAgentId | null;
  intent?: string | null;
  memoryType: GtAgentMemoryType;
  content: string;
  source: GtAgentMemorySource;
  status: GtAgentMemoryStatus;
  confidence: number;
  evidenceCount: number;
  sourceEventIds: string[];
  createdAt: string;
  updatedAt: string;
  lastObservedAt?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  supersededByMemoryId?: string | null;
};

export type GtAgentMemoryWriteInput = {
  clinicId: string;
  userId?: string | null;
  entityType?: GtAgentMemoryEntityType | null;
  entityId?: string | null;
  agentId?: GreatTimeAgentId | null;
  intent?: string | null;
  memoryType: GtAgentMemoryType;
  content: string;
  source: GtAgentMemorySource;
  confidence?: number;
  evidenceCount?: number;
  sourceEventIds?: string[];
  observedAt?: string;
};

export type GtAgentMemoryPolicyDecision =
  | { accepted: true; status: GtAgentMemoryStatus; confidence: number }
  | { accepted: false; reason: string };

export type GtAgentRelevantMemory = GtAgentMemoryRecord & {
  relevanceScore: number;
};

export type GtAgentSessionSummaryV2 = {
  id: string;
  clinicId: string;
  userId: string;
  sessionId: string;
  activeTopic: string;
  lastResolvedAgent: GreatTimeAgentId;
  lastIntent: string;
  selectedDateRange: {
    fromDate?: string;
    toDate?: string;
    label?: string;
    timezone?: string;
  };
  activeEntityRefs: Array<{
    entityType: string;
    entityId: string;
    displayName?: string;
    rank?: number;
  }>;
  unresolvedClarification?: string | null;
  preferredResponseLanguage?: string | null;
  preferredResponseStyle?: string | null;
  lastRecommendationIds: string[];
  recentTurnSummary: string[];
  usedMemoryIds: string[];
  updatedAt: string;
  expiresAt: string;
};

export type GtAgentRecommendationState =
  | "shown"
  | "accepted"
  | "dismissed"
  | "contacted"
  | "replied"
  | "booked"
  | "paid"
  | "visited"
  | "no_reply"
  | "not_interested"
  | "remind_later"
  | "failed";

export type GtAgentRecommendationOutcome = {
  id: string;
  recommendationId: string;
  clinicId: string;
  userId?: string | null;
  sessionId?: string | null;
  requestId?: string | null;
  responseId?: string | null;
  resolvedAgent?: GreatTimeAgentId | null;
  intent?: string | null;
  recommendationType?: string | null;
  targetCustomerKey?: string | null;
  state: GtAgentRecommendationState;
  sourceTools: string[];
  sourceEvidenceRefs: string[];
  shownAt?: string | null;
  acceptedAt?: string | null;
  contactedAt?: string | null;
  observedAt?: string | null;
  verificationWindowDays?: number | null;
  createdAt: string;
  updatedAt: string;
};

export type GtAgentInsightCardStatus = "new" | "viewed" | "dismissed" | "accepted" | "done" | "remind_later";
export type GtAgentInsightCardType =
  | "unused_package_recovery"
  | "inactive_high_value_customer"
  | "treatment_due"
  | "rising_cancellations_no_shows"
  | "service_sales_high_usage_low"
  | "declining_service_usage"
  | "practitioner_capacity_gap"
  | "collections_below_sales";

export type GtAgentInsightCard = {
  id: string;
  clinicId: string;
  dedupeKey: string;
  type: GtAgentInsightCardType;
  impactArea: string;
  title: string;
  summary: string;
  basePriorityScore: number;
  personalizedPriorityScore: number;
  evidenceRefs: string[];
  sourceTools: string[];
  checkedAt: string;
  expiresAt: string;
  status: GtAgentInsightCardStatus;
  verificationNeeded: boolean;
  createdAt: string;
  updatedAt: string;
};

export type GtAgentFactSnapshot = {
  id: string;
  clinicId: string;
  clinicCode: string;
  snapshotType: string;
  bucket: string;
  source: string;
  checkedAt: string;
  dataStatus: AgentDataStatus;
  freshnessSeconds?: number;
  expiresAt?: string | null;
  dateRange?: {
    fromDate: string;
    toDate: string;
    timezone?: string;
  };
  summary: Record<string, unknown>;
};

export type GtAgentMemoryContext = {
  memories: GtAgentRelevantMemory[];
  usedMemoryIds: string[];
};

export type GtAgentRecommendationWithId = GreatTimeAgentRecommendation & {
  recommendationId: string;
  recommendationType?: string;
  targetCustomerKey?: string;
};
