import { createAgentToolRegistry } from "./tool-registry.js";
import { executeToolPlan } from "./tool-executor.js";
import { resolveEntityReference } from "./entity-context.js";
import {
  extractExplicitCustomerSearchText as extractCustomerSearchText,
  hasCustomerEntityReference,
  hasExplicitCustomerSearchIntent as hasCustomerSearchIntent,
} from "./customer-query.js";
import { planAgentRequest } from "./intent-planner.js";
import { enhanceAgentResponseNarrative } from "./narrative.service.js";
import { buildAgentResponse } from "./response-builder.js";
import { newId, nowIso, sanitizeError } from "./safety.js";
import { applyMemoryPreferencesToResponse } from "./memory/memory-writer.js";
import { retrieveMemoryContext } from "./memory/memory-retriever.js";
import {
  getAgentSession,
  getAgentSessionEntityRefs,
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

export function shouldIgnoreExplicitEntityContext(params: {
  request: GreatTimeAgentChatRequest;
}) {
  const searchText = extractExplicitCustomerSearchText(params.request.message);
  return Boolean(
    params.request.entityContext?.entityType === "customer" &&
      searchText &&
      !searchTextMatchesEntity(searchText, params.request.entityContext),
  );
}

function forceFollowUpPlan(params: {
  plan: ReturnType<typeof planAgentRequest>;
  entityContext: GreatTimeAgentEntityContext | undefined;
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
  const sessionRefs = params.request.sessionId
    ? await getAgentSessionEntityRefs({
        clinicId: params.clinic.clinicId,
        userId: params.requestContext.userId,
        sessionId,
      }).catch(() => [])
    : [];
  const resolvedRef = resolveEntityReference({
    message: params.request.message,
    explicit: params.request.entityContext,
    sessionRefs,
  });
  const shouldIgnoreContext = shouldIgnoreExplicitEntityContext({
    request: params.request,
  });
  const request = {
    ...withFollowUpAgentInference(params.request, resolvedRef),
    entityContext: shouldIgnoreContext ? undefined : (params.request.entityContext ?? resolvedRef ?? undefined),
  };
  const initialPlan = planAgentRequest({ request });
  const plan = forceFollowUpPlan({
    plan: initialPlan,
    entityContext: request.entityContext,
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
