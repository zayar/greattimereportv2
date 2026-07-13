import { createAgentToolRegistry } from "./tool-registry.js";
import { executeToolPlan } from "./tool-executor.js";
import { resolveEntityReference } from "./entity-context.js";
import {
  extractExplicitCustomerSearchText as extractCustomerSearchText,
  hasCustomerEntityReference,
  hasExplicitCustomerSearchIntent as hasCustomerSearchIntent,
} from "./customer-query.js";
import { isExportOnlyFollowUp } from "./export-intent.js";
import { extractExplicitServiceSearchText, hasExplicitServiceSearchIntent, isService360Question } from "./service-query.js";
import { hasExplicitPeriodCue, planAgentRequest } from "./intent-planner.js";
import { planAgentRecovery } from "./recovery-planner.js";
import { enhanceAgentResponseNarrative } from "./narrative.service.js";
import { planSemanticAgentRequest } from "./semantic-planner.js";
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
import { getAnalyticsQueryCacheStats } from "../bigquery.service.js";
import {
  normalizeMonitoringErrorCategory,
  redactMonitoringText,
} from "./monitoring/agent-monitoring.service.js";
import type {
  AgentClinicContext,
  AgentRequestContext,
  AgentToolResult,
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

function buildToolTraceMetadata(toolResults: AgentToolResult[], totalToolLatencyMs: number) {
  const fallbackLatencyMs = toolResults.length ? Math.max(0, Math.round(totalToolLatencyMs / toolResults.length)) : 0;
  const toolExecutionResults = toolResults.map((result) => ({
    toolName: result.toolName,
    latencyMs: result.latencyMs ?? fallbackLatencyMs,
    timedOut: result.timedOut === true,
    dataStatus: result.dataStatus,
    ...(result.errorCategory ? { errorCategory: result.errorCategory } : {}),
  }));

  return {
    sourceDurations: toolExecutionResults.map((result) => ({
      toolName: result.toolName,
      durationMs: result.latencyMs,
      dataStatus: result.dataStatus,
      timedOut: result.timedOut,
      ...(result.errorCategory ? { errorCategory: result.errorCategory } : {}),
    })),
    toolExecutionResults,
    timedOutTools: toolExecutionResults.filter((result) => result.timedOut).map((result) => result.toolName),
    unavailableTools: toolExecutionResults
      .filter((result) => result.dataStatus === "unavailable")
      .map((result) => result.toolName),
  };
}

function cleanTracePayload<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cleanTracePayload(item)) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, cleanTracePayload(entry)]),
    ) as T;
  }

  return value;
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
    if (params.plan.intent === "customer_purchase_history" || params.plan.intent === "customer_overview") {
      return params.plan;
    }

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

function buildExportOnlyFollowUpResponse(params: {
  request: GreatTimeAgentChatRequest;
  sessionId: string;
  requestId: string;
}): GreatTimeAgentChatResponse {
  const request = {
    ...params.request,
    entityContext: undefined,
  };
  const plan = planAgentRequest({ request });
  const message = [
    "I can export only from structured table rows in a previous answer.",
    "Use the CSV export action on the table, or ask the report again with export csv.",
    "Excel requests currently return CSV.",
  ].join("\n");

  return {
    sessionId: params.sessionId,
    requestId: params.requestId,
    responseId: newId("resp"),
    requestedAgent: plan.requestedAgent,
    resolvedAgent: plan.resolvedAgent,
    autoMode: plan.autoMode,
    intent: "csv_export_follow_up",
    period: plan.period,
    assistantMessage: message,
    summary: message,
    followUpQuestions: [],
    sources: [],
    dataStatus: "not_ready",
    warnings: [
      {
        type: "csv_export_requires_table",
        title: "CSV export needs a table",
        message: "This request is export-only, so Agent Hub did not run a new report.",
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

export async function askAgentHub(params: {
  request: GreatTimeAgentChatRequest;
  clinic: AgentClinicContext;
  requestContext: AgentRequestContext;
}): Promise<GreatTimeAgentChatResponse> {
  const totalStartedAt = Date.now();
  const sessionId = params.request.sessionId ?? newId("session");
  const requestId = params.request.requestId ?? newId("req");
  const runId = requestId;
  const traceCreatedAt = nowIso();
  const traceTimeline: Array<{ label: string; status: string; at: string; detail?: string | null }> = [];
  const buildBaseTrace = () => ({
    runId,
    clinicId: params.clinic.clinicId,
    clinicCode: params.clinic.clinicCode,
    clinicName: null,
    userId: params.requestContext.userId,
    userEmail: params.requestContext.userEmail ?? null,
    sessionId,
    requestId,
    responseId: requestId,
    channel: params.requestContext.channel ?? "web",
    telegramChatIdHash: params.requestContext.telegramChatIdHash ?? null,
    telegramUserIdHash: params.requestContext.telegramUserIdHash ?? null,
    telegramMessageId: params.requestContext.telegramMessageId ?? null,
    telegramCallbackDataType: params.requestContext.telegramCallbackDataType ?? null,
    questionPreview: redactMonitoringText(params.request.message, 500),
    createdAt: traceCreatedAt,
  });
  const recordTrace = async (
    update: Partial<Parameters<typeof saveAgentRunTrace>[0]> & {
      timelineLabel?: string;
      timelineStatus?: string;
      timelineDetail?: string | null;
    },
  ) => {
    const at = nowIso();
    if (update.timelineLabel) {
      traceTimeline.push({
        label: update.timelineLabel,
        status: update.timelineStatus ?? update.status ?? "completed",
        at,
        detail: redactMonitoringText(update.timelineDetail, 300),
      });
    }

    const { timelineLabel, timelineStatus, timelineDetail, ...traceUpdate } = update;
    try {
      await saveAgentRunTrace(cleanTracePayload({
        ...buildBaseTrace(),
        ...traceUpdate,
        updatedAt: at,
        timeline: [...traceTimeline],
      }));
    } catch (error) {
      console.warn("[agent-hub] failed to write monitoring trace", error);
    }
  };

  await recordTrace({
    status: "running",
    currentStep: "Request received",
    timelineLabel: "Request received",
    timelineStatus: "running",
  });

  if (isExportOnlyFollowUp(params.request.message)) {
    const response = buildExportOnlyFollowUpResponse({
      request: params.request,
      sessionId,
      requestId,
    });
    await recordTrace({
      status: "completed",
      currentStep: "Export follow-up completed",
      responseId: response.responseId,
      requestedAgent: response.requestedAgent,
      resolvedAgent: response.resolvedAgent,
      intent: response.intent,
      toolNames: [],
      sourceStatuses: [],
      dataStatus: response.dataStatus,
      fallbackUsed: true,
      deterministicResponseUsed: true,
      totalLatencyMs: Date.now() - totalStartedAt,
      answerPreview: redactMonitoringText(response.assistantMessage, 500),
      completedAt: nowIso(),
      timelineLabel: "Response generated",
      timelineStatus: "completed",
    });
    return response;
  }

  const registry = createAgentToolRegistry();
  const planningStartedAt = Date.now();
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
  let request = {
    ...withFollowUpAgentInference(params.request, resolvedRef),
    fromDate: shouldUseSummaryRange ? summaryRange?.fromDate : params.request.fromDate,
    toDate: shouldUseSummaryRange ? summaryRange?.toDate : params.request.toDate,
    timezone: params.request.timezone ?? summaryRange?.timezone,
    entityContext: shouldIgnoreContext ? undefined : (params.request.entityContext ?? resolvedRef ?? undefined),
  };
  const initialPlan = planAgentRequest({ request });
  const semanticPlanningResult = await planSemanticAgentRequest({
    request,
    deterministicPlan: initialPlan,
    session: {
      activeTopic: session?.summaryV2?.activeTopic ?? null,
      lastIntent: session?.lastIntent ?? session?.summaryV2?.lastIntent ?? null,
      entityRefs: sessionRefs.map((ref) => ({
        entityType: ref.entityType,
        displayName: ref.displayName,
        rank: ref.rank,
      })),
    },
    registry,
  });
  if (!request.entityContext && semanticPlanningResult.entityContext) {
    request = {
      ...request,
      entityContext: semanticPlanningResult.entityContext,
    };
  }
  const plan = forceFollowUpPlan({
    plan: semanticPlanningResult.plan,
    entityContext: request.entityContext,
    request,
  });
  const semanticTraceMetadata = {
    semanticPlannerAttempted: semanticPlanningResult.metadata.attempted,
    semanticPlannerUsed: semanticPlanningResult.metadata.used,
    semanticPlannerFallbackUsed: semanticPlanningResult.metadata.fallbackUsed,
    semanticPlannerFallbackReason: semanticPlanningResult.metadata.fallbackReason ?? null,
    semanticPlannerModel: semanticPlanningResult.metadata.model ?? null,
    semanticPlannerLanguage: semanticPlanningResult.metadata.language ?? null,
    semanticPlannerConfidence: semanticPlanningResult.metadata.confidence ?? null,
    semanticPlannerLatencyMs: semanticPlanningResult.metadata.latencyMs,
    provider: semanticPlanningResult.metadata.provider ?? null,
    model: semanticPlanningResult.metadata.model ?? null,
    promptTokens: semanticPlanningResult.metadata.promptTokens ?? null,
    completionTokens: semanticPlanningResult.metadata.completionTokens ?? null,
    estimatedCostUsd: semanticPlanningResult.metadata.estimatedCostUsd ?? null,
  };
  const planningLatencyMs = Date.now() - planningStartedAt;
  await recordTrace({
    status: "planning",
    currentStep: "Intent planned",
    requestedAgent: plan.requestedAgent,
    resolvedAgent: plan.resolvedAgent,
    intent: plan.intent,
    toolNames: plan.toolNames,
    planningLatencyMs,
    ...semanticTraceMetadata,
    timelineLabel: "Intent planned",
    timelineStatus: "completed",
    timelineDetail: `${plan.resolvedAgent} · ${plan.intent}`,
  });
  const memoryStartedAt = Date.now();
  const memoryContext = await retrieveMemoryContext({
    clinicId: params.clinic.clinicId,
    userId: params.requestContext.userId,
    request,
    plan,
  }).catch(() => ({ memories: [], usedMemoryIds: [] }));
  const memoryLatencyMs = Date.now() - memoryStartedAt;
  await recordTrace({
    status: "planning",
    currentStep: "Memory loaded",
    memoryLatencyMs,
    usedMemoryIds: memoryContext.usedMemoryIds,
    timelineLabel: "Memory loaded",
    timelineStatus: "completed",
    timelineDetail: `${memoryContext.usedMemoryIds.length} memories`,
  });

  const cacheStatsBefore = getAnalyticsQueryCacheStats();
  const toolStartedAt = Date.now();
  await recordTrace({
    status: "calling_tools",
    currentStep: plan.unsupportedReason ? "No tools needed" : "Calling tools",
    toolNames: plan.toolNames,
    timelineLabel: plan.unsupportedReason ? "Tool execution skipped" : "Tool execution started",
    timelineStatus: plan.unsupportedReason ? "completed" : "started",
    timelineDetail: plan.unsupportedReason ?? plan.toolNames.join(", "),
  });
  const initialToolResults = plan.unsupportedReason
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
  const recoveryPlan = plan.unsupportedReason
    ? null
    : planAgentRecovery({
        plan,
        toolResults: initialToolResults,
      });
  const recoveryToolResults = recoveryPlan
    ? await executeToolPlan({
        toolNames: recoveryPlan.toolNames,
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
        maxConcurrency: 1,
      })
    : [];
  const toolResults = [...initialToolResults, ...recoveryToolResults];
  const toolLatencyMs = Date.now() - toolStartedAt;
  const cacheStatsAfter = getAnalyticsQueryCacheStats();
  const earlyToolTraceMetadata = buildToolTraceMetadata(toolResults, toolLatencyMs);
  await recordTrace({
    status: "generating_response",
    currentStep: "Tools completed",
    toolLatencyMs,
    sourceStatuses: toolResults.map((result) => result.dataStatus),
    dataStatus: toolResults.some((result) => result.dataStatus === "unavailable") ? "partial" : undefined,
    ...earlyToolTraceMetadata,
    timelineLabel: "Tools completed",
    timelineStatus: toolResults.some((result) => result.timedOut || result.errorCategory) ? "failed" : "completed",
    timelineDetail: `${toolResults.length} tools`,
  });
  if (recoveryPlan) {
    await recordTrace({
      status: "generating_response",
      currentStep: "Recovery tools completed",
      recoveryToolNames: recoveryPlan.toolNames,
      recoveryReason: recoveryPlan.reason,
      timelineLabel: "Recovery tools completed",
      timelineStatus: recoveryToolResults.some((result) => result.dataStatus === "unavailable") ? "failed" : "completed",
      timelineDetail: recoveryPlan.reason,
    });
  }

  const deterministicResponse = buildAgentResponse({
    request,
    plan,
    sessionId,
    requestId,
    toolResults,
    unsupportedReason: plan.unsupportedReason,
  });
  const narrativeStartedAt = Date.now();
  const narrativeResult = await enhanceAgentResponseNarrative(deterministicResponse, {
    memories: memoryContext.memories,
    clinicId: params.clinic.clinicId,
  });
  const narrativeLatencyMs = Date.now() - narrativeStartedAt;
  const narrativeResponse = narrativeResult.response;
  const response = applyMemoryPreferencesToResponse(narrativeResponse, memoryContext.memories);
  await recordTrace({
    status: "sending_response",
    currentStep: "Response generated",
    responseId: response.responseId,
    requestedAgent: response.requestedAgent,
    resolvedAgent: response.resolvedAgent,
    intent: response.intent,
    sourceStatuses: response.sources.map((source) => source.dataStatus),
    dataStatus: response.dataStatus,
    fallbackUsed: narrativeResult.fallbackUsed,
    narrativeFallbackUsed: narrativeResult.fallbackUsed,
    narrativeSkipped: narrativeResult.narrativeSkipped,
    narrativeCacheHit: narrativeResult.cacheHit,
    deterministicResponseUsed: narrativeResult.fallbackUsed || narrativeResult.narrativeSkipped,
    narrativeLatencyMs,
    answerPreview: redactMonitoringText(response.assistantMessage, 500),
    warnings: response.warnings?.map((warning) => `${warning.title}: ${warning.message}`),
    timelineLabel: "Response generated",
    timelineStatus: "completed",
  });
  const toolTraceMetadata = buildToolTraceMetadata(toolResults, toolLatencyMs);
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
    saveAgentRunTrace(cleanTracePayload({
      ...buildBaseTrace(),
      clinicId: params.clinic.clinicId,
      userId: params.requestContext.userId,
      sessionId,
      requestId,
      runId,
      responseId: response.responseId,
      status: "completed",
      currentStep: "Completed",
      channel: params.requestContext.channel ?? "web",
      userEmail: params.requestContext.userEmail ?? null,
      clinicCode: params.clinic.clinicCode,
      telegramChatIdHash: params.requestContext.telegramChatIdHash ?? null,
      telegramUserIdHash: params.requestContext.telegramUserIdHash ?? null,
      telegramMessageId: params.requestContext.telegramMessageId ?? null,
      telegramCallbackDataType: params.requestContext.telegramCallbackDataType ?? null,
      questionPreview: redactMonitoringText(request.message, 500),
      answerPreview: redactMonitoringText(response.assistantMessage, 500),
      requestedAgent: response.requestedAgent,
      resolvedAgent: response.resolvedAgent,
      intent: response.intent,
      toolNames: plan.toolNames,
      recoveryToolNames: recoveryPlan?.toolNames ?? [],
      recoveryReason: recoveryPlan?.reason ?? null,
      sourceStatuses: response.sources.map((source) => source.dataStatus),
      dataStatus: response.dataStatus,
      fallbackUsed: narrativeResult.fallbackUsed,
      narrativeFallbackUsed: narrativeResult.fallbackUsed,
      narrativeSkipped: narrativeResult.narrativeSkipped,
      narrativeCacheHit: narrativeResult.cacheHit,
      deterministicResponseUsed: narrativeResult.fallbackUsed || narrativeResult.narrativeSkipped,
      usedMemoryIds: memoryContext.usedMemoryIds,
      totalLatencyMs: Date.now() - totalStartedAt,
      planningLatencyMs,
      ...semanticTraceMetadata,
      memoryLatencyMs,
      toolLatencyMs,
      narrativeLatencyMs,
      cacheStats: {
        bigQueryHits: cacheStatsAfter.hits - cacheStatsBefore.hits,
        bigQueryMisses: cacheStatsAfter.misses - cacheStatsBefore.misses,
      },
      ...toolTraceMetadata,
      warnings: response.warnings?.map((warning) => `${warning.title}: ${warning.message}`),
      createdAt: traceCreatedAt,
      updatedAt: nowIso(),
      completedAt: nowIso(),
      timeline: [
        ...traceTimeline,
        {
          label: "Completed",
          status: "completed",
          at: nowIso(),
        },
      ],
    })).catch((error) =>
      saveAgentRunTrace(cleanTracePayload({
        ...buildBaseTrace(),
        clinicId: params.clinic.clinicId,
        userId: params.requestContext.userId,
        sessionId,
        requestId,
        runId,
        responseId: response.responseId,
        status: "completed",
        currentStep: "Completed with trace warning",
        channel: params.requestContext.channel ?? "web",
        userEmail: params.requestContext.userEmail ?? null,
        clinicCode: params.clinic.clinicCode,
        telegramChatIdHash: params.requestContext.telegramChatIdHash ?? null,
        telegramUserIdHash: params.requestContext.telegramUserIdHash ?? null,
        telegramMessageId: params.requestContext.telegramMessageId ?? null,
        telegramCallbackDataType: params.requestContext.telegramCallbackDataType ?? null,
        questionPreview: redactMonitoringText(request.message, 500),
        answerPreview: redactMonitoringText(response.assistantMessage, 500),
        requestedAgent: response.requestedAgent,
        resolvedAgent: response.resolvedAgent,
        intent: response.intent,
        toolNames: plan.toolNames,
        recoveryToolNames: recoveryPlan?.toolNames ?? [],
        recoveryReason: recoveryPlan?.reason ?? null,
        sourceStatuses: response.sources.map((source) => source.dataStatus),
        dataStatus: response.dataStatus,
        fallbackUsed: narrativeResult.fallbackUsed,
        narrativeFallbackUsed: narrativeResult.fallbackUsed,
        narrativeSkipped: narrativeResult.narrativeSkipped,
        narrativeCacheHit: narrativeResult.cacheHit,
        deterministicResponseUsed: narrativeResult.fallbackUsed || narrativeResult.narrativeSkipped,
        usedMemoryIds: memoryContext.usedMemoryIds,
        totalLatencyMs: Date.now() - totalStartedAt,
        planningLatencyMs,
        ...semanticTraceMetadata,
        memoryLatencyMs,
        toolLatencyMs,
        narrativeLatencyMs,
        cacheStats: {
          bigQueryHits: cacheStatsAfter.hits - cacheStatsBefore.hits,
          bigQueryMisses: cacheStatsAfter.misses - cacheStatsBefore.misses,
        },
        ...toolTraceMetadata,
        createdAt: traceCreatedAt,
        updatedAt: nowIso(),
        completedAt: nowIso(),
        timeline: traceTimeline,
        errorCategory: normalizeMonitoringErrorCategory(sanitizeError(error)),
        sanitizedError: sanitizeError(error),
      })),
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
