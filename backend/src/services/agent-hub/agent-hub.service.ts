import { createAgentToolRegistry } from "./tool-registry.js";
import { executeToolPlan } from "./tool-executor.js";
import { resolveEntityReference } from "./entity-context.js";
import {
  extractExplicitCustomerSearchText as extractCustomerSearchText,
  hasCustomerEntityReference,
  hasExplicitCustomerSearchIntent as hasCustomerSearchIntent,
} from "./customer-query.js";
import { extractExplicitServiceSearchText, hasExplicitServiceSearchIntent, isService360Question } from "./service-query.js";
import { planAgentRequest } from "./intent-planner.js";
import { enhanceAgentResponseNarrative } from "./narrative.service.js";
import { buildAgentResponse } from "./response-builder.js";
import { newId, nowIso, sanitizeError } from "./safety.js";
import { applyMemoryPreferencesToResponse } from "./memory/memory-writer.js";
import { retrieveMemoryContext } from "./memory/memory-retriever.js";
import { saveRecommendationOutcome } from "./memory/memory.repository.js";
import {
  getAgentSession,
  saveAgentSessionTurn,
} from "./session.repository.js";
import { saveAgentRunTrace } from "./trace.repository.js";
import type {
  AgentClinicContext,
  AgentRequestContext,
  GreatTimeAgentChatRequest,
  GreatTimeAgentChatResponse,
  GreatTimeAgentEntityContext,
  GreatTimeRequestedAgentId,
} from "./types.js";
import type { ReportPremiumAccess } from "../../types/report-ai.js";

function inferAgentFromEntity(ref: GreatTimeAgentEntityContext | null): GreatTimeRequestedAgentId | null {
  if (!ref) {
    return null;
  }

  if (ref.entityType === "appointment") {
    return "appointment";
  }
  if (ref.entityType === "customer") {
    return "customer_relationship";
  }
  if (ref.entityType === "service" || ref.entityType === "practitioner") {
    return "business";
  }
  if (ref.entityType === "invoice") {
    return "finance";
  }

  return null;
}

function withFollowUpAgentInference(
  request: GreatTimeAgentChatRequest,
  resolvedRef: GreatTimeAgentEntityContext | null,
): GreatTimeAgentChatRequest {
  if (request.agent && request.agent !== "auto") {
    return request;
  }

  if (request.entityContext?.entityType === "customer" && hasExplicitCustomerSearchIntent(request.message)) {
    return {
      ...request,
      agent: "customer_relationship",
    };
  }

  if (request.entityContext?.entityType === "service" && hasExplicitServiceSearchIntent(request.message)) {
    return {
      ...request,
      agent: "business",
    };
  }

  const inferredAgent = inferAgentFromEntity(resolvedRef);
  if (!inferredAgent) {
    return request;
  }

  if (hasCustomerEntityReference(request.message)) {
    return {
      ...request,
      agent: inferredAgent,
    };
  }

  return request;
}

export function hasExplicitCustomerSearchIntent(message: string) {
  return hasCustomerSearchIntent(message);
}

export function extractExplicitCustomerSearchText(message: string) {
  return extractCustomerSearchText(message);
}

function normalizeNameForComparison(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function searchTextMatchesEntity(searchText: string, entityContext: GreatTimeAgentEntityContext | undefined) {
  const search = normalizeNameForComparison(searchText);
  const name = normalizeNameForComparison(entityContext?.customerName ?? entityContext?.displayName);

  return Boolean(search && name && (search === name || name.includes(search) || search.includes(name)));
}

function serviceTextMatchesEntity(searchText: string, entityContext: GreatTimeAgentEntityContext | undefined) {
  const search = normalizeNameForComparison(searchText);
  const name = normalizeNameForComparison(entityContext?.serviceName ?? entityContext?.displayName);

  return Boolean(search && name && (search === name || name.includes(search) || search.includes(name)));
}

function hasExplicitPeriodCue(message: string) {
  return /last\s+\d+\s+days|last\s+90\s+days|90\s+days|last\s+30\s+days|30\s+days|this\s+week|current\s+week|last\s+week|previous\s+week|yesterday|today|now|right now|this\s+month|current\s+month|month\s+to\s+date|mtd|this\s+year|current\s+year|year\s+to\s+date|ytd|ဒီနေ့|ဒီ\s*လ|ဒီ\s*နှစ်|မနေ့/i.test(
    message,
  );
}

function recommendationOpportunityKey(params: {
  recommendation: NonNullable<GreatTimeAgentChatResponse["recommendations"]>[number];
  intent: string;
}) {
  if (params.recommendation.opportunityKey) {
    return params.recommendation.opportunityKey;
  }

  const target = params.recommendation.targetCustomerKey ?? params.recommendation.title ?? params.recommendation.message;
  return `${params.recommendation.recommendationType ?? params.intent}:${target}`.slice(0, 200);
}

async function registerShownRecommendations(params: {
  clinicId: string;
  userId: string;
  sessionId: string;
  response: GreatTimeAgentChatResponse;
  fallbackSourceTools: string[];
}) {
  const recommendations = params.response.recommendations ?? [];
  if (recommendations.length === 0) {
    return;
  }

  const shownAt = nowIso();
  await Promise.all(
    recommendations
      .filter((recommendation) => recommendation.recommendationId)
      .map((recommendation) =>
        saveRecommendationOutcome({
          id: recommendation.recommendationId!,
          recommendationId: recommendation.recommendationId!,
          clinicId: params.clinicId,
          userId: params.userId,
          sessionId: params.sessionId,
          requestId: params.response.requestId,
          responseId: params.response.responseId,
          resolvedAgent: params.response.resolvedAgent,
          intent: params.response.intent,
          recommendationType: recommendation.recommendationType ?? params.response.intent,
          opportunityKey: recommendationOpportunityKey({
            recommendation,
            intent: params.response.intent,
          }),
          targetCustomerKey: recommendation.targetCustomerKey ?? null,
          state: "shown",
          sourceTools: recommendation.sourceTools.length ? recommendation.sourceTools : params.fallbackSourceTools,
          sourceEvidenceRefs: params.response.sources.map((source) => `${source.tool}:${source.checkedAt}`),
          shownAt,
          acceptedAt: null,
          contactedAt: null,
          observedAt: null,
          verificationWindowDays: 30,
          createdAt: shownAt,
          updatedAt: shownAt,
        }),
      ),
  );
}

export function shouldIgnoreExplicitEntityContext(params: {
  request: GreatTimeAgentChatRequest;
}) {
  const searchText = extractExplicitCustomerSearchText(params.request.message);
  const serviceSearchText = extractExplicitServiceSearchText(params.request.message);
  return Boolean(
    (params.request.entityContext?.entityType === "customer" &&
      searchText &&
      !searchTextMatchesEntity(searchText, params.request.entityContext)) ||
      (params.request.entityContext?.entityType === "service" &&
        serviceSearchText &&
        !serviceTextMatchesEntity(serviceSearchText, params.request.entityContext)),
  );
}

function forceFollowUpPlan(params: {
  plan: ReturnType<typeof planAgentRequest>;
  entityContext: GreatTimeAgentEntityContext | undefined;
  request: GreatTimeAgentChatRequest;
}) {
  if (!params.entityContext) {
    return params.plan;
  }

  if (params.plan.resolvedAgent === "customer_relationship" && params.entityContext.entityType === "customer") {
    return {
      ...params.plan,
      intent: "customer_360",
      toolNames: ["get_customer_360"],
    };
  }

  if (
    params.plan.resolvedAgent === "business" &&
    params.entityContext.entityType === "service" &&
    (isService360Question(params.request.message) || /tell\s+me|details?|what\s+do\s+we\s+know|how\s+is|service\s*360/i.test(params.request.message))
  ) {
    return {
      ...params.plan,
      intent: "service_360",
      toolNames: ["get_service_360"],
    };
  }

  if (params.plan.resolvedAgent === "appointment" && params.entityContext.entityType === "appointment") {
    return {
      ...params.plan,
      intent: params.plan.intent === "checked_in_customers" ? "checked_in_customers" : "appointment_detail",
      toolNames: params.plan.intent === "checked_in_customers" ? ["get_checked_in_customers"] : ["get_appointment_detail"],
    };
  }

  return params.plan;
}

export async function askAgentHub(params: {
  request: GreatTimeAgentChatRequest;
  clinic: AgentClinicContext;
  requestContext: AgentRequestContext;
}): Promise<GreatTimeAgentChatResponse> {
  const sessionId = params.request.sessionId ?? newId("session");
  const requestId = params.request.requestId ?? newId("req");
  const registry = createAgentToolRegistry();
  const session = params.request.sessionId
    ? await getAgentSession({
        clinicId: params.clinic.clinicId,
        userId: params.requestContext.userId,
        sessionId,
      }).catch(() => null)
    : null;
  const summaryRefs =
    session?.summaryV2?.activeEntityRefs.map((ref) => ({
      entityType: ref.entityType as GreatTimeAgentEntityContext["entityType"],
      entityId: ref.entityId,
      displayName: ref.displayName,
      rank: ref.rank,
    })) ?? [];
  const sessionRefs = [...(session?.entityRefs ?? []), ...summaryRefs];
  const resolvedRef = resolveEntityReference({
    message: params.request.message,
    explicit: params.request.entityContext,
    sessionRefs,
  });
  const shouldIgnoreContext = shouldIgnoreExplicitEntityContext({
    request: params.request,
  });
  const summaryRange = session?.summaryV2?.selectedDateRange;
  const shouldUseSummaryRange = Boolean(
    !params.request.fromDate &&
      !params.request.toDate &&
      summaryRange?.fromDate &&
      summaryRange?.toDate &&
      !hasExplicitPeriodCue(params.request.message),
  );
  const request = {
    ...withFollowUpAgentInference(params.request, resolvedRef),
    fromDate: shouldUseSummaryRange ? summaryRange?.fromDate : params.request.fromDate,
    toDate: shouldUseSummaryRange ? summaryRange?.toDate : params.request.toDate,
    timezone: params.request.timezone ?? summaryRange?.timezone,
    entityContext: shouldIgnoreContext ? undefined : (params.request.entityContext ?? resolvedRef ?? undefined),
  };
  const initialPlan = planAgentRequest({ request });
  const plan = forceFollowUpPlan({
    plan: initialPlan,
    entityContext: request.entityContext,
    request,
  });
  const memoryContext = await retrieveMemoryContext({
    clinicId: params.clinic.clinicId,
    userId: params.requestContext.userId,
    request,
    plan,
  }).catch(() => ({ memories: [], usedMemoryIds: [] }));

  const toolResults = plan.unsupportedReason
    ? []
    : await executeToolPlan({
        toolNames: plan.toolNames,
        agentId: plan.resolvedAgent,
        input: {
          request,
          clinic: params.clinic,
          period: plan.period,
          intent: plan.intent,
          entityContext: request.entityContext,
          requestContext: params.requestContext,
        },
        registry,
      });

  const deterministicResponse = buildAgentResponse({
    request,
    plan,
    sessionId,
    requestId,
    toolResults,
    unsupportedReason: plan.unsupportedReason,
  });
  const narrativeResult = await enhanceAgentResponseNarrative(deterministicResponse, {
    memories: memoryContext.memories,
  });
  const narrativeResponse = narrativeResult.response;
  const response = applyMemoryPreferencesToResponse(narrativeResponse, memoryContext.memories);
  const entityRefs = toolResults.flatMap((result) => result.entityRefs ?? []).map((ref) => ({
    ...ref,
    sourceResponseId: response.responseId,
  }));

  await Promise.allSettled([
    saveAgentSessionTurn({
      clinicId: params.clinic.clinicId,
      userId: params.requestContext.userId,
      sessionId,
      request,
      response,
      entityRefs,
      usedMemories: memoryContext.memories,
    }),
    saveAgentRunTrace({
      clinicId: params.clinic.clinicId,
      userId: params.requestContext.userId,
      sessionId,
      requestId,
      responseId: response.responseId,
      requestedAgent: response.requestedAgent,
      resolvedAgent: response.resolvedAgent,
      intent: response.intent,
      toolNames: plan.toolNames,
      sourceStatuses: response.sources.map((source) => source.dataStatus),
      dataStatus: response.dataStatus,
      fallbackUsed: narrativeResult.fallbackUsed,
      usedMemoryIds: memoryContext.usedMemoryIds,
      createdAt: nowIso(),
    }).catch((error) =>
      saveAgentRunTrace({
        clinicId: params.clinic.clinicId,
        userId: params.requestContext.userId,
        sessionId,
        requestId,
        responseId: response.responseId,
        requestedAgent: response.requestedAgent,
        resolvedAgent: response.resolvedAgent,
        intent: response.intent,
        toolNames: plan.toolNames,
        sourceStatuses: response.sources.map((source) => source.dataStatus),
        dataStatus: response.dataStatus,
        fallbackUsed: narrativeResult.fallbackUsed,
        usedMemoryIds: memoryContext.usedMemoryIds,
        createdAt: nowIso(),
        sanitizedError: sanitizeError(error),
      }),
    ),
    registerShownRecommendations({
      clinicId: params.clinic.clinicId,
      userId: params.requestContext.userId,
      sessionId,
      response,
      fallbackSourceTools: plan.toolNames,
    }),
  ]);

  return response;
}

export function buildLockedAgentHubResponse(params: {
  request: GreatTimeAgentChatRequest;
  premium: ReportPremiumAccess;
}): GreatTimeAgentChatResponse {
  const request = params.request;
  const plan = planAgentRequest({ request });
  const sessionId = request.sessionId ?? newId("session");
  const requestId = request.requestId ?? newId("req");
  const responseId = newId("resp");
  const message =
    params.premium.upgradeMessage ??
    params.premium.message ??
    "GT Growth AI is not enabled for this clinic.";

  return {
    sessionId,
    requestId,
    responseId,
    requestedAgent: plan.requestedAgent,
    resolvedAgent: plan.resolvedAgent,
    autoMode: plan.autoMode,
    intent: "feature_locked",
    period: plan.period,
    assistantMessage: message,
    summary: message,
    recommendations: [
      {
        recommendationId: `rec_feature_locked_${requestId}`,
        recommendationType: "feature_upgrade",
        title: params.premium.title || "Unlock GT Growth AI",
        message,
        sourceTools: [],
      },
    ],
    followUpQuestions: [],
    sources: [
      {
        tool: "gt_growth_ai_feature_gate",
        sourceName: "GT Growth AI feature access",
        checkedAt: nowIso(),
        dataStatus: "not_ready",
        live: false,
      },
    ],
    dataStatus: "not_ready",
    warnings: [
      {
        type: "feature_locked",
        title: params.premium.title || "GT Growth AI locked",
        message: params.premium.lockedReason ?? params.premium.message,
      },
    ],
    actions: [
      {
        type: "read_only_agent_response",
        detail: "No GreatTime records were changed.",
      },
    ],
  };
}

export async function readAgentHubSession(params: {
  clinicId: string;
  userId: string;
  sessionId: string;
}) {
  return getAgentSession(params);
}
