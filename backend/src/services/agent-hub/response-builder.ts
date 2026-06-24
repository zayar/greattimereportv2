import { createHash } from "node:crypto";
import { combineStatuses, newId, nowIso } from "./safety.js";
import type {
  AgentToolResult,
  Customer360FactPack,
  GreatTimeAgentChatRequest,
  GreatTimeAgentChatResponse,
  GreatTimeAgentIntentPlan,
  Service360FactPack,
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

function followUpsForCustomer360(factPack: Customer360FactPack) {
  const questions: string[] = [];

  if (factPack.packages.holdings.length > 0 || factPack.packages.dataStatus === "partial") {
    questions.push("Show unused package services.");
  }

  if (factPack.payments.invoiceCount || factPack.payments.recentInvoices.length > 0) {
    questions.push("Show purchase and payment details.");
  }

  const hasLiveAppointments = (factPack.appointments.current?.length ?? 0) > 0 || (factPack.appointments.upcoming?.length ?? 0) > 0;
  const hasRecentCompleted = (factPack.appointments.recentCompleted?.length ?? 0) > 0;

  if (hasLiveAppointments && hasRecentCompleted) {
    questions.push("Show upcoming and past appointments.");
  } else if (hasLiveAppointments) {
    questions.push("Show upcoming appointments.");
  } else if (hasRecentCompleted) {
    questions.push("Show recent completed treatments.");
  }

  if (factPack.usage.topServices.length > 0 || factPack.visitPattern.momentum !== "unknown") {
    questions.push("Show service usage and visit frequency over time.");
  }

  return questions.length
    ? questions.slice(0, 4)
    : ["Show recent treatments.", "Show service usage this month.", "Show purchase and package details."];
}

function hasActionableCustomerRows(results: AgentToolResult[]) {
  return results.some((result) => {
    if (result.customer360 || (result.entityRefs?.length ?? 0) > 0) {
      return true;
    }

    return (result.tables ?? []).some((table) => table.rows.length > 0);
  });
}

function followUpsForService360(factPack: Service360FactPack) {
  const questions = [
    `Which customers used ${factPack.identity.displayName} most this month?`,
    `Which practitioners handled ${factPack.identity.displayName} most this month?`,
    `Which services are bought together with ${factPack.identity.displayName}?`,
  ];

  return questions.slice(0, 3);
}

function followUpsForAgent(
  plan: GreatTimeAgentIntentPlan,
  results: AgentToolResult[],
  customer360?: Customer360FactPack,
  service360?: Service360FactPack,
) {
  if (customer360) {
    return followUpsForCustomer360(customer360);
  }

  if (service360) {
    return followUpsForService360(service360);
  }

  if (plan.resolvedAgent === "finance") {
    return [
      "Compare this month sales with the same days last month.",
      "Show this month collection by payment method.",
      "Which payment method needs reconciliation this month?",
    ];
  }

  if (plan.resolvedAgent === "customer_relationship") {
    if (!hasActionableCustomerRows(results)) {
      return [];
    }

    return [
      "Tell me about the first customer.",
      "Show the first customer's last treatment and package balance.",
      "Which top customers should we thank this month?",
    ];
  }

  if (plan.resolvedAgent === "business") {
    return [
      "Which service is declining this month?",
      "Which practitioners handled the most treatments this month?",
      "Show top services this month.",
    ];
  }

  return [
    "Show all appointments today.",
    "How many appointments are scheduled today?",
    "Show checked-out customers today.",
    "Which customers may not have started treatment?",
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
  const customer360 = params.toolResults.find((result) => result.customer360)?.customer360;
  const service360 = params.toolResults.find((result) => result.service360)?.service360;
  const entityContext = params.toolResults.flatMap((result) => result.entityRefs ?? [])[0] ?? params.request.entityContext;
  const summary = params.unsupportedReason ?? defaultSummary(params.plan, params.toolResults);
  const sources = params.toolResults.flatMap((result) =>
    result.sources?.length
      ? result.sources
      : [
          {
            tool: result.toolName,
            sourceName: result.sourceName,
            checkedAt: result.checkedAt || nowIso(),
            period: result.period,
            dataStatus: result.dataStatus,
            live: result.live,
          },
        ],
  );

  return {
    sessionId: params.sessionId,
    requestId: params.requestId,
    responseId,
    requestedAgent: params.plan.requestedAgent,
    resolvedAgent: params.plan.resolvedAgent,
    autoMode: params.plan.autoMode,
    intent: params.plan.intent,
    period: params.plan.period,
    assistantMessage: summary,
    summary,
    metrics: metrics.length ? metrics : undefined,
    tables: tables.length ? tables : undefined,
    recommendations: recommendations.length ? recommendations : undefined,
    followUpQuestions: followUpsForAgent(params.plan, params.toolResults, customer360, service360),
    customer360,
    service360,
    sources,
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
