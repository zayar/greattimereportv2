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
  CustomerRelationshipRiskLevel,
  CustomerRelationshipSegment,
  GreatTimeAgentChatRequest,
  GreatTimeAgentChatResponse,
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

export async function recordGreatTimeAgentFeedback(params: {
  clinicId: string;
  sessionId: string;
  responseId: string;
  rating: "helpful" | "not_helpful";
  note?: string | null;
  outcome?: "messaged" | "replied" | "booked" | "no_reply" | "not_interested" | null;
}) {
  const response = await apiClient.post<{ success: true; data: { createdAt: string } }>(
    "/ai/agent/feedback",
    params,
  );

  return response.data.data;
}
