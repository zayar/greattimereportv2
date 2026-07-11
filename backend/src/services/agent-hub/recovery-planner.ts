import type { AgentToolResult, GreatTimeAgentIntentPlan } from "./types.js";

export type AgentRecoveryPlan = {
  toolNames: string[];
  reason: string;
};

function isUnavailable(result: AgentToolResult | undefined) {
  return result?.dataStatus === "unavailable" || result?.dataStatus === "not_ready";
}

/**
 * A deliberately small second pass for source recovery. It is deterministic,
 * bounded to one additional read-only tool, and never allows a model to invent
 * new tools or alter business records.
 */
export function planAgentRecovery(params: {
  plan: GreatTimeAgentIntentPlan;
  toolResults: AgentToolResult[];
}): AgentRecoveryPlan | null {
  const executedTools = new Set(params.toolResults.map((result) => result.toolName));

  if (
    params.plan.resolvedAgent === "business" &&
    params.plan.intent === "owner_daily_brief" &&
    isUnavailable(params.toolResults.find((result) => result.toolName === "get_owner_daily_brief")) &&
    !executedTools.has("get_business_health_snapshot")
  ) {
    return {
      toolNames: ["get_business_health_snapshot"],
      reason: "Owner brief snapshots were unavailable, so the agent checked the source-backed business health fallback.",
    };
  }

  if (
    params.plan.resolvedAgent === "appointment" &&
    params.plan.intent === "appointment_summary" &&
    isUnavailable(params.toolResults.find((result) => result.toolName === "get_live_appointment_counts")) &&
    !executedTools.has("get_appointment_ledger")
  ) {
    return {
      toolNames: ["get_appointment_ledger"],
      reason: "Live appointment counts were unavailable, so the agent checked the appointment ledger fallback.",
    };
  }

  return null;
}
