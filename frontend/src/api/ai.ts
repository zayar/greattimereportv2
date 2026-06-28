import { apiClient } from "./http";
import type {
  AiCustomerInsightResponse,
  AiExecutiveSummaryResponse,
  AiLanguage,
  AiServiceInsightResponse,
  CustomerRelationshipAgentResponse,
  CustomerRelationshipEvidence,
  CustomerRelationshipEvidenceType,
  CustomerRelationshipFeedbackOutcome,
  CustomerRelationshipFollowUpMessage,
  CustomerRelationshipFollowUpTone,
  CustomerRelationshipLearningSummary,
  CustomerRelationshipProfilesResponse,
  CustomerRelationshipIntent,
  CustomerRelationshipRiskLevel,
  CustomerRelationshipSegment,
  GreatTimeAgentChatRequest,
  GreatTimeAgentChatResponse,
  GreatTimeAgentId,
  GreatTimeAgentStatusReport,
  AgentStatusRange,
} from "../types/domain";

type BaseAiRequest = {
  clinicId: string;
  clinicCode: string;
  fromDate: string;
  toDate: string;
  aiLanguage?: AiLanguage;
};

export async function fetchAiExecutiveSummary(
  params: BaseAiRequest & { filters?: Record<string, unknown> },
) {
  const response = await apiClient.post<{ success: true; data: AiExecutiveSummaryResponse }>(
    "/ai/executive-summary",
    params,
  );

  return response.data.data;
}

export async function fetchAiCustomerInsight(
  params: BaseAiRequest & {
    customerName: string;
    customerPhone: string;
  },
) {
  const response = await apiClient.post<{ success: true; data: AiCustomerInsightResponse }>(
    "/ai/customer-insight",
    params,
  );

  return response.data.data;
}

export async function fetchAiServiceInsight(
  params: BaseAiRequest & {
    serviceName: string;
  },
) {
  const response = await apiClient.post<{ success: true; data: AiServiceInsightResponse }>(
    "/ai/service-insight",
    params,
  );

  return response.data.data;
}

type CustomerRelationshipBaseRequest = {
  clinicId: string;
  clinicCode: string;
};

export async function runCustomerRelationshipLearning(
  params: CustomerRelationshipBaseRequest & {
    aiLanguage?: AiLanguage;
    lookbackDays?: number;
  },
) {
  const response = await apiClient.post<{ success: true; data: CustomerRelationshipLearningSummary }>(
    "/ai/customer-relationship-agent/learn",
    params,
  );

  return response.data.data;
}

export async function fetchCustomerRelationshipProfiles(
  params: CustomerRelationshipBaseRequest & {
    intent?: CustomerRelationshipIntent | "";
    segment?: CustomerRelationshipSegment | "";
    riskLevel?: CustomerRelationshipRiskLevel | "";
    search?: string;
    sortBy?: "priorityScore" | "lastVisitDate" | "daysSinceLastVisit" | "lifetimeSpend" | "remainingPackageSessions";
    sortDirection?: "asc" | "desc";
    limit?: number;
    offset?: number;
  },
) {
  const queryParams = {
    ...params,
    segment: params.segment || undefined,
    riskLevel: params.riskLevel || undefined,
  };
  const response = await apiClient.get<{ success: true; data: CustomerRelationshipProfilesResponse }>(
    "/ai/customer-relationship-agent/profiles",
    { params: queryParams },
  );

  return response.data.data;
}

export async function askCustomerRelationshipAgent(
  params: CustomerRelationshipBaseRequest & {
    question: string;
    aiLanguage?: AiLanguage;
    autoLearnIfStale?: boolean;
  },
) {
  const response = await apiClient.post<{ success: true; data: CustomerRelationshipAgentResponse }>(
    "/ai/customer-relationship-agent/ask",
    params,
  );

  return response.data.data;
}

export async function generateCustomerFollowUpMessage(
  params: CustomerRelationshipBaseRequest & {
    customerKey: string;
    aiLanguage?: AiLanguage;
    tone?: CustomerRelationshipFollowUpTone;
  },
) {
  const response = await apiClient.post<{ success: true; data: CustomerRelationshipFollowUpMessage }>(
    "/ai/customer-relationship-agent/follow-up-message",
    params,
  );

  return response.data.data;
}

export async function fetchCustomerRelationshipEvidence(
  params: CustomerRelationshipBaseRequest & {
    customerKey: string;
    evidenceType?: CustomerRelationshipEvidenceType;
    year?: number;
  },
) {
  const response = await apiClient.post<{ success: true; data: CustomerRelationshipEvidence | null }>(
    "/ai/customer-relationship-agent/evidence",
    params,
  );

  return response.data.data;
}

export async function recordCustomerRelationshipFeedback(
  params: CustomerRelationshipBaseRequest & {
    customerKey: string;
    outcome: CustomerRelationshipFeedbackOutcome;
    note?: string | null;
  },
) {
  const response = await apiClient.post<{ success: true; data: unknown }>(
    "/ai/customer-relationship-agent/feedback",
    params,
  );

  return response.data.data;
}

export async function askGreatTimeAgentHub(params: GreatTimeAgentChatRequest) {
  const response = await apiClient.post<{ success: true; data: GreatTimeAgentChatResponse }>(
    "/ai/agent/chat",
    params,
  );

  return response.data.data;
}

export async function fetchGreatTimeAgentStatus(params?: {
  clinicId?: string;
  range?: AgentStatusRange;
  includeDetails?: boolean;
}) {
  const response = await apiClient.get<{ success: true; data: GreatTimeAgentStatusReport }>(
    "/ai/agent/status",
    { params },
  );

  return response.data.data;
}

export async function recordGreatTimeAgentFeedback(params: {
  clinicId: string;
  sessionId: string;
  responseId: string;
  requestId?: string | null;
  recommendationId?: string | null;
  recommendationType?: string | null;
  opportunityKey?: string | null;
  targetCustomerKey?: string | null;
  feedbackType?: "helpful" | "not_helpful" | "wrong_data" | "too_long" | "too_short" | "remember_this" | "correction";
  rating: "helpful" | "not_helpful";
  note?: string | null;
  outcome?:
    | "shown"
    | "accepted"
    | "dismissed"
    | "contacted"
    | "messaged"
    | "replied"
    | "booked"
    | "paid"
    | "visited"
    | "no_reply"
    | "not_interested"
    | "remind_later"
    | "failed"
    | null;
  resolvedAgent?: GreatTimeAgentId | null;
  intent?: string | null;
  sourceTools?: string[];
  usedMemoryIds?: string[];
}) {
  const response = await apiClient.post<{ success: true; data: { createdAt: string } }>(
    "/ai/agent/feedback",
    params,
  );

  return response.data.data;
}
