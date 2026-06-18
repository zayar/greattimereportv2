import { createAgentToolRegistry } from "./tool-registry.js";
import { executeToolPlan } from "./tool-executor.js";
import { resolveEntityReference } from "./entity-context.js";
import { planAgentRequest } from "./intent-planner.js";
import { enhanceAgentResponseNarrative } from "./narrative.service.js";
import { buildAgentResponse } from "./response-builder.js";
import { newId, nowIso, sanitizeError } from "./safety.js";
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
) {
  if (request.agent && request.agent !== "auto") {
    return request;
  }

  const inferredAgent = inferAgentFromEntity(resolvedRef);
  if (!inferredAgent) {
    return request;
  }

  if (/\b(first|second|third|they|them|that|her|him|သူ|အဲ့ဒီ)\b/i.test(request.message)) {
    return {
      ...request,
      agent: inferredAgent,
    };
  }

  return request;
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
      intent: "customer_overview",
      toolNames: ["get_customer_overview", "get_customer_packages", "get_customer_bookings", "get_customer_payments"],
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
  const request = {
    ...withFollowUpAgentInference(params.request, resolvedRef),
    entityContext: params.request.entityContext ?? resolvedRef ?? undefined,
  };
  const initialPlan = planAgentRequest({ request });
  const plan = forceFollowUpPlan({
    plan: initialPlan,
    entityContext: request.entityContext,
  });

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
  const response = await enhanceAgentResponseNarrative(deterministicResponse);
  const entityRefs = toolResults.flatMap((result) => result.entityRefs ?? []).map((ref) => ({
    ...ref,
    sourceResponseId: response.responseId,
  }));

  await Promise.allSettled([
    saveAgentSessionTurn({
      clinicId: params.clinic.clinicId,
      userId: params.requestContext.userId,
      sessionId,
      response,
      entityRefs,
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
      fallbackUsed: true,
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
        fallbackUsed: true,
        createdAt: nowIso(),
        sanitizedError: sanitizeError(error),
      }),
    ),
  ]);

  return response;
}

export async function readAgentHubSession(params: {
  clinicId: string;
  userId: string;
  sessionId: string;
}) {
  return getAgentSession(params);
}
