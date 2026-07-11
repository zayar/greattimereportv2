import { createHash } from "node:crypto";
import { buildReadOnlyRefusalMessage } from "./read-only-guard.js";
import { combineStatuses, newId, nowIso } from "./safety.js";
import type {
  AgentSourceScope,
  AgentToolResult,
  Customer360FactPack,
  GreatTimeAgentSource,
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

function buildUnsupportedWriteSummary() {
  return [
    buildReadOnlyRefusalMessage(),
    "",
    "I can show the relevant sourced records so an authorized person can review them manually.",
  ].join("\n");
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

function hasAppointmentRows(results: AgentToolResult[]) {
  return results.some((result) =>
    (result.tables ?? []).some((table) => /appointment|checked|cancel|no-show/i.test(table.title) && table.rows.length > 0),
  );
}

function followUpsForAppointment(plan: GreatTimeAgentIntentPlan, results: AgentToolResult[]) {
  const hasRows = hasAppointmentRows(results);

  switch (plan.intent) {
    case "checked_in_customers":
      return [
        "Show customers who arrived but have not started treatment.",
        "Show appointments not checked out today.",
        "Show checked-out customers today.",
      ];
    case "checked_out_customers":
      return [
        "Show checked-in customers now.",
        "Show appointments not checked out today.",
        "Show cancelled and no-show appointments today.",
      ];
    case "not_checked_out_customers":
      return [
        "Show checked-in customers now.",
        "Show checked-out customers today.",
        "Show customers who arrived but have not started treatment.",
      ];
    case "arrived_not_started_customers":
      return [
        "Show appointments not checked out today.",
        "Show checked-in customers now.",
        "Show checked-out customers today.",
      ];
    case "cancelled_no_show":
      return [
        "Show all appointments today.",
        "Show appointments not checked out today.",
        "Show checked-in customers now.",
      ];
    case "waiting_customers":
    case "treatment_in_progress":
      return [
        "Show customers who arrived but have not started treatment.",
        "Show checked-in customers now.",
        "Show checked-out customers today.",
      ];
    case "appointment_trend":
      return [
        "Show all appointments today.",
        "Show appointments not checked out today.",
        "Show cancelled and no-show appointments today.",
      ];
    case "appointment_detail":
      return [
        "Show all appointments today.",
        "Show appointments not checked out today.",
        "Show checked-in customers now.",
      ];
    case "appointment_summary":
    case "appointment_list":
    default:
      return hasRows
        ? [
            "Show checked-in customers now.",
            "Show appointments not checked out today.",
            "Show customers who arrived but have not started treatment.",
            "Show checked-out customers today.",
          ]
        : [
            "Show tomorrow appointments.",
            "Show appointments not checked out today.",
            "Show appointment trend this week.",
          ];
  }
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

    if (plan.intent === "customer_purchase_history") {
      return [
        "Show this customer's package balance.",
        "Show this customer's treatment history.",
        "Show full customer profile.",
      ];
    }

    if (["unactivated_purchase", "package_bought_never_came", "package_bought_never_used", "package_bought_not_used"].includes(plan.intent)) {
      return [
        "Tell me about the first customer.",
        "Show the first customer's purchase details.",
        "Show the first customer's package balance.",
      ];
    }

    if (["dormant_with_active_balance_90d", "lapsed_customer_90d", "reactivated_customer"].includes(plan.intent)) {
      return [
        "Tell me about the first customer.",
        "Show dormant package customers.",
        "Who should the relationship team contact today?",
      ];
    }

    return [
      "Bought but not started customers.",
      "Dormant package customers.",
      "Follow-up opportunities today.",
    ];
  }

  if (plan.resolvedAgent === "business") {
    return [
      "Which service is declining this month?",
      "Which practitioners handled the most treatments this month?",
      "Show top services this month.",
    ];
  }

  return followUpsForAppointment(plan, results);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordsFrom(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringFrom(value: unknown) {
  return typeof value === "string" && value.trim().length ? value.trim() : undefined;
}

function sourceScopeFrom(value: unknown): AgentSourceScope | undefined {
  return value === "live" || value === "historical" || value === "learned" || value === "cache" ? value : undefined;
}

function formatOwnerBriefMetric(metric: Record<string, unknown>) {
  const label = stringFrom(metric.label);
  const value = metric.value;

  if (!label || value == null) {
    return null;
  }

  const formattedValue = typeof value === "number" ? value.toLocaleString("en-US") : String(value);
  return `${label}: ${formattedValue}`;
}

function numberedLines(items: string[], fallback: string) {
  const lines = items.filter(Boolean).slice(0, 5);
  const body = lines.length ? lines : [fallback];

  return body.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

function formatOwnerBriefItems(items: Record<string, unknown>[], emptyMessage: string) {
  const lines = items.map((item) => {
    const title = stringFrom(item.title);
    const reason = stringFrom(item.reason);
    const severity = stringFrom(item.severity);
    const priority = typeof item.priority === "number" ? `Priority ${item.priority}` : undefined;
    const qualifier = severity ?? priority;

    if (!title && !reason) {
      return "";
    }

    const titleText = title ?? reason ?? "";
    const suffix = reason && title ? ` - ${reason}` : "";
    return `${titleText}${qualifier ? ` (${qualifier})` : ""}${suffix}`;
  });

  return numberedLines(lines, emptyMessage);
}

function ownerBriefSourcesFrom(result: AgentToolResult): GreatTimeAgentSource[] {
  if (result.sources?.length) {
    return result.sources;
  }

  const dataSources = recordsFrom(result.data?.sources);
  return dataSources
    .map((source) => ({
      tool: stringFrom(source.tool) ?? result.toolName,
      sourceName: stringFrom(source.sourceName) ?? result.sourceName,
      checkedAt: stringFrom(source.checkedAt) ?? result.checkedAt,
      period: stringFrom(source.period),
      dataStatus: stringFrom(source.dataStatus) === "partial" ? "partial" : result.dataStatus,
      freshnessSeconds: typeof source.freshnessSeconds === "number" ? source.freshnessSeconds : undefined,
      live: typeof source.live === "boolean" ? source.live : result.live,
      scope: sourceScopeFrom(source.scope),
    }))
    .slice(0, 6);
}

function hasOwnerBriefSnapshotSource(params: {
  sources: GreatTimeAgentSource[];
  metrics: Record<string, unknown>[];
  snapshotType: string;
  sourceNamePattern: RegExp;
}) {
  return (
    params.metrics.some((metric) => metric.sourceSnapshotType === params.snapshotType) ||
    params.sources.some((source) => params.sourceNamePattern.test(source.sourceName))
  );
}

function missingOwnerBriefSourceNames(result: AgentToolResult) {
  const sources = ownerBriefSourcesFrom(result);
  const metrics = recordsFrom(result.data?.metrics);
  const missing: string[] = [];

  if (!hasOwnerBriefSnapshotSource({ sources, metrics, snapshotType: "finance_daily_snapshot", sourceNamePattern: /finance daily/i })) {
    missing.push("finance daily snapshot");
  }

  if (
    !hasOwnerBriefSnapshotSource({
      sources,
      metrics,
      snapshotType: "appointment_daily_profile",
      sourceNamePattern: /appointment daily/i,
    })
  ) {
    missing.push("appointment daily profile");
  }

  return missing;
}

function formatOwnerBriefFreshness(result: AgentToolResult) {
  const sources = ownerBriefSourcesFrom(result);

  if (!sources.length) {
    return "Data source: no useful owner brief snapshots were available.";
  }

  const sourceNotes = sources.slice(0, 4).map((source) => {
    const freshness =
      typeof source.freshnessSeconds === "number" ? ` (${Math.max(0, Math.round(source.freshnessSeconds))}s fresh)` : "";
    return `${source.sourceName} checked at ${source.checkedAt}${freshness}`;
  });

  return `Data source: ${sourceNotes.join("; ")}.`;
}

function buildOwnerDailyBriefMessage(result: AgentToolResult) {
  if (result.dataStatus === "not_ready") {
    return [
      "Owner daily brief is not ready yet.",
      "",
      "No source-backed owner brief snapshots were available. Run the Agent learning/snapshot job, or ask the normal finance, appointment, and business report tools for a live/source-backed view.",
      "",
      formatOwnerBriefFreshness(result),
    ].join("\n");
  }

  const data = isRecord(result.data) ? result.data : {};
  const headline = stringFrom(data.headline) ?? result.summary ?? "Here is today's owner brief.";
  const metrics = recordsFrom(data.metrics).map(formatOwnerBriefMetric).filter((line): line is string => Boolean(line));
  const risks = recordsFrom(data.risks);
  const actions = recordsFrom(data.recommendedActions);
  const missingSources = result.dataStatus === "partial" ? missingOwnerBriefSourceNames(result) : [];
  const partialNote = missingSources.length ? `This brief is partial: missing ${missingSources.join(" and ")}.` : undefined;

  return [
    "Here is today's owner brief.",
    "",
    headline,
    ...(partialNote ? ["", partialNote] : []),
    "",
    "Key metrics:",
    numberedLines(metrics, "No source-backed key metrics were available yet."),
    "",
    "What needs attention:",
    formatOwnerBriefItems(risks, "No high-priority risk cards were available from snapshots."),
    "",
    "Recommended next actions:",
    formatOwnerBriefItems(actions, "No recommended action cards were available yet."),
    "",
    formatOwnerBriefFreshness(result),
  ].join("\n");
}

function safeResponseDataFromToolResults(results: AgentToolResult[]) {
  const data: Record<string, unknown> = {};
  const countDefinitions: unknown[] = [];

  results.forEach((result) => {
    const toolData = result.data ?? {};
    const countDefinition = toolData.countDefinition;
    if (countDefinition) {
      countDefinitions.push(countDefinition);
      data.countDefinition ??= countDefinition;
    }

    if (Array.isArray(toolData.countDefinitions)) {
      toolData.countDefinitions.forEach((definition) => countDefinitions.push(definition));
    }

    if (toolData.operationsReconciliation) {
      data.operationsReconciliation = toolData.operationsReconciliation;
    }

    if (toolData.appointmentFilter) {
      data.appointmentFilter ??= toolData.appointmentFilter;
    }

    if (toolData.treatmentDetailFilter) {
      data.treatmentDetailFilter ??= toolData.treatmentDetailFilter;
    }
  });

  if (countDefinitions.length) {
    const seen = new Set<string>();
    data.countDefinitions = countDefinitions.filter((definition) => {
      if (!definition || typeof definition !== "object" || !("grain" in definition)) {
        return true;
      }

      const grain = String((definition as { grain: unknown }).grain);
      if (seen.has(grain)) {
        return false;
      }

      seen.add(grain);
      return true;
    });
  }

  return Object.keys(data).length ? data : undefined;
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
  const isUnsupportedWriteRequest = params.plan.intent === "unsupported_write_request" || Boolean(params.unsupportedReason);
  const sourceStatuses = params.toolResults.map((result) => result.dataStatus);
  const dataStatus = isUnsupportedWriteRequest ? "not_ready" : combineStatuses(sourceStatuses);
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
  const entityRefs = params.toolResults.flatMap((result) => result.entityRefs ?? []);
  const entityContext = entityRefs[0] ?? params.request.entityContext;
  const ownerDailyBriefResult = params.toolResults.find((result) => result.toolName === "get_owner_daily_brief");
  const ownerBriefNeedsFallback =
    ownerDailyBriefResult &&
    ["not_ready", "unavailable"].includes(ownerDailyBriefResult.dataStatus) &&
    params.toolResults.some((result) => result.toolName === "get_business_health_snapshot" && result.dataStatus !== "unavailable");
  const responseData = safeResponseDataFromToolResults(params.toolResults);
  const summary =
    isUnsupportedWriteRequest ? buildUnsupportedWriteSummary() :
    (ownerDailyBriefResult && !ownerBriefNeedsFallback
      ? buildOwnerDailyBriefMessage(ownerDailyBriefResult)
      : defaultSummary(params.plan, params.toolResults));
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
    followUpQuestions: isUnsupportedWriteRequest
      ? ["Show the relevant records for manual review."]
      : followUpsForAgent(params.plan, params.toolResults, customer360, service360),
    data: responseData,
    customer360,
    service360,
    sources,
    dataStatus,
    warnings: warnings.length ? warnings : undefined,
    entityContext,
    entityRefs: entityRefs.length ? entityRefs : params.request.entityContext ? [params.request.entityContext] : undefined,
    actions: [
      {
        type: "read_only_agent_response",
        detail: isUnsupportedWriteRequest
          ? "Write request blocked. No GreatTime records were changed."
          : "No GreatTime records were changed.",
      },
    ],
  };
}
