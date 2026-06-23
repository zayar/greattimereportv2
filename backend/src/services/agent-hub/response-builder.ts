import { createHash } from "node:crypto";
import { combineStatuses, newId, nowIso } from "./safety.js";
import type {
  AgentToolResult,
  GreatTimeAgentChatRequest,
  GreatTimeAgentChatResponse,
  GreatTimeAgentIntentPlan,
} from "./types.js";

function defaultSummary(plan: GreatTimeAgentIntentPlan, results: AgentToolResult[]) {
  const okSources = results.filter((result) => result.dataStatus === "ok").length;
  const sourceCount = results.length;
  const firstSummary = results.find((result) => result.summary)?.summary;

  if (firstSummary) {
    return firstSummary;
  }

  if (plan.intent === "unsupported_write_request") {
    return "This Agent Hub is read-only. I can review sourced GreatTime data, but cannot mutate operational records.";
  }

  if (sourceCount === 0) {
    return "I could not run a source tool for this question.";
  }

  return `I checked ${sourceCount} source tool${sourceCount === 1 ? "" : "s"} and ${okSources} returned current data.`;
}

function followUpsForAgent(plan: GreatTimeAgentIntentPlan) {
  if (plan.resolvedAgent === "finance") {
    return [
      "Compare this period with the previous period.",
      "Show payment methods by amount.",
      "Which invoices should we review next?",
    ];
  }

  if (plan.resolvedAgent === "customer_relationship") {
    return [
      "Tell me about the first customer.",
      "Show their last treatment and recent purchases.",
      "Which customers should we follow up today?",
    ];
  }

  if (plan.resolvedAgent === "business") {
    return [
      "Which service is declining?",
      "Which practitioners handle that service most?",
      "Show daily treatment volume.",
    ];
  }

  return [
    "Who are the checked-in customers?",
    "Show checked-out customers today.",
    "Which customers are definitely waiting for treatment?",
  ];
}

function stableRecommendationId(params: {
  clinicId: string;
  sessionId: string;
  requestId: string;
  resolvedAgent: string;
  intent: string;
  index: number;
  title?: string;
  message: string;
}) {
  const hash = createHash("sha256")
    .update(
      [
        params.clinicId,
        params.sessionId,
        params.requestId,
        params.resolvedAgent,
        params.intent,
        params.index,
        params.title ?? "",
        params.message,
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 24);

  return `rec_${hash}`;
}

export function buildAgentResponse(params: {
  request: GreatTimeAgentChatRequest;
  plan: GreatTimeAgentIntentPlan;
  sessionId: string;
  requestId: string;
  toolResults: AgentToolResult[];
  unsupportedReason?: string;
}): GreatTimeAgentChatResponse {
  const responseId = newId("resp");
  const sourceStatuses = params.toolResults.map((result) => result.dataStatus);
  const dataStatus = params.unsupportedReason ? "not_ready" : combineStatuses(sourceStatuses);
  const metrics = params.toolResults.flatMap((result) => result.metrics ?? []);
  const tables = params.toolResults.flatMap((result) => result.tables ?? []);
  const recommendations = params.toolResults
    .flatMap((result) => result.recommendations ?? [])
    .map((recommendation, index) => ({
      ...recommendation,
      recommendationId:
        recommendation.recommendationId ??
        stableRecommendationId({
          clinicId: params.request.clinicId,
          sessionId: params.sessionId,
          requestId: params.requestId,
          resolvedAgent: params.plan.resolvedAgent,
          intent: params.plan.intent,
          index,
          title: recommendation.title,
          message: recommendation.message,
        }),
    }));
  const warnings = [
    ...(params.plan.warnings ?? []),
    ...params.toolResults.flatMap((result) => result.warnings ?? []),
  ];
  const entityContext = params.toolResults.flatMap((result) => result.entityRefs ?? [])[0] ?? params.request.entityContext;
  const summary = params.unsupportedReason ?? defaultSummary(params.plan, params.toolResults);

  return {
    sessionId: params.sessionId,
    requestId: params.requestId,
    responseId,
    requestedAgent: params.plan.requestedAgent,
    resolvedAgent: params.plan.resolvedAgent,
    autoMode: params.plan.autoMode,
    intent: params.plan.intent,
    assistantMessage: summary,
    summary,
    metrics: metrics.length ? metrics : undefined,
    tables: tables.length ? tables : undefined,
    recommendations: recommendations.length ? recommendations : undefined,
    followUpQuestions: followUpsForAgent(params.plan),
    sources: params.toolResults.map((result) => ({
      tool: result.toolName,
      sourceName: result.sourceName,
      checkedAt: result.checkedAt || nowIso(),
      period: result.period,
      dataStatus: result.dataStatus,
      live: result.live,
    })),
    dataStatus,
    warnings: warnings.length ? warnings : undefined,
    entityContext,
    actions: [
      {
        type: "read_only_agent_response",
        detail: "No GreatTime records were changed.",
      },
    ],
  };
}
