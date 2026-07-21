import { createHash } from "node:crypto";
import { z } from "zod";
import { env } from "../../config/env.js";
import { createAiProvider } from "../ai/provider.js";
import type { AiJsonProvider, AiStructuredJsonResult } from "../ai/provider.js";
import { createAgentToolRegistry } from "./tool-registry.js";
import { applyIntentPeriodDefaults, toolsForIntent } from "./intent-planner.js";
import type {
  AgentToolDefinition,
  GreatTimeAgentChatRequest,
  GreatTimeAgentEntityContext,
  GreatTimeAgentId,
  GreatTimeAgentIntentPlan,
} from "./types.js";

const INTENTS_BY_AGENT = {
  finance: [
    "sales_summary",
    "payment_summary",
    "payment_method_breakdown",
    "payment_method_detail",
    "sales_period_comparison",
    "customer_purchase_history",
    "customer_payment_history",
    "invoice_detail",
  ],
  customer_relationship: [
    "birthday_customers",
    "customer_search",
    "customer_overview",
    "customer_360",
    "customer_purchase_history",
    "unused_package_balance",
    "unactivated_purchase",
    "dormant_with_active_balance_90d",
    "lapsed_customer_90d",
    "reactivated_customer",
    "package_bought_never_came",
    "package_bought_not_used",
    "package_bought_never_used",
    "treatment_due",
    "churn_risk",
    "follow_up_today",
    "top_customers",
    "top_customers_by_revenue",
    "top_customers_by_visits",
  ],
  business: [
    "business_health",
    "owner_daily_brief",
    "service_360",
    "service_performance",
    "service_trend",
    "practitioner_performance",
    "operations_count_reconciliation",
    "treatment_detail",
    "service_treatment_detail",
    "practitioner_treatment_detail",
    "treatment_roster",
    "daily_treatment",
  ],
  appointment: [
    "appointment_summary",
    "appointment_list",
    "live_appointment_counts",
    "checked_in_customers",
    "checked_out_customers",
    "not_checked_out_customers",
    "arrived_not_started_customers",
    "cancelled_no_show",
    "waiting_customers",
    "treatment_in_progress",
    "appointment_detail",
    "appointment_trend",
  ],
  consultant: ["consultant_service_advice", "consultant_trending_services"],
} as const satisfies Record<GreatTimeAgentId, readonly string[]>;

const ALL_INTENTS = [...new Set(Object.values(INTENTS_BY_AGENT).flat())] as [string, ...string[]];
const REQUESTED_FACTS = [
  "identity",
  "last_visit",
  "visit_count",
  "revenue",
  "payment",
  "purchase_history",
  "package_holdings",
  "unused_package",
  "remaining_sessions",
  "service",
  "service_performance",
  "therapist",
  "therapist_performance",
  "appointment",
  "appointment_status",
  "birthday",
  "follow_up",
  "trend",
  "comparison",
] as const;

const semanticDecisionSchema = z.object({
  language: z.enum(["en", "my", "mixed"]),
  resolvedAgent: z.enum(["finance", "customer_relationship", "business", "appointment"]),
  intent: z.enum(ALL_INTENTS),
  confidence: z.number().min(0).max(1),
  requestedFacts: z.array(z.enum(REQUESTED_FACTS)).max(12),
  entity: z.object({
    type: z.enum(["none", "customer", "service", "package", "practitioner", "appointment", "invoice"]),
    name: z.string().max(120),
  }),
});

const SEMANTIC_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    language: { type: "STRING", enum: ["en", "my", "mixed"] },
    resolvedAgent: {
      type: "STRING",
      enum: ["finance", "customer_relationship", "business", "appointment"],
    },
    intent: { type: "STRING", enum: ALL_INTENTS },
    confidence: { type: "NUMBER", minimum: 0, maximum: 1 },
    requestedFacts: {
      type: "ARRAY",
      maxItems: 12,
      items: { type: "STRING", enum: REQUESTED_FACTS },
    },
    entity: {
      type: "OBJECT",
      properties: {
        type: {
          type: "STRING",
          enum: ["none", "customer", "service", "package", "practitioner", "appointment", "invoice"],
        },
        name: { type: "STRING", maxLength: 120 },
      },
      required: ["type", "name"],
    },
  },
  required: ["language", "resolvedAgent", "intent", "confidence", "requestedFacts", "entity"],
} satisfies Record<string, unknown>;

export type SemanticPlannerMetadata = {
  attempted: boolean;
  used: boolean;
  fallbackUsed: boolean;
  fallbackReason?: string;
  latencyMs: number;
  provider?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  estimatedCostUsd?: number;
  language?: "en" | "my" | "mixed";
  confidence?: number;
};

export type SemanticPlannerResult = {
  plan: GreatTimeAgentIntentPlan;
  entityContext?: GreatTimeAgentEntityContext;
  metadata: SemanticPlannerMetadata;
};

type SemanticSessionContext = {
  activeTopic?: string | null;
  lastIntent?: string | null;
  entityRefs?: Array<Pick<GreatTimeAgentEntityContext, "entityType" | "displayName" | "rank">>;
};

function stripJsonFences(payload: string) {
  return payload.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
}

function redactLongNumbers(value: string) {
  return value.replace(/(?:\+?\d[\s()-]?){7,}/g, "[number redacted]");
}

function normalizeGroundingText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function isGroundedEntityName(params: {
  name: string;
  message: string;
  session?: SemanticSessionContext;
}) {
  const name = normalizeGroundingText(params.name);
  if (!name || ["customer", "service", "package", "therapist", "practitioner", "appointment", "invoice"].includes(name)) {
    return false;
  }

  if (normalizeGroundingText(params.message).includes(name)) {
    return true;
  }

  return Boolean(
    params.session?.entityRefs?.some((ref) => normalizeGroundingText(ref.displayName ?? "") === name),
  );
}

function semanticEntityContext(params: {
  entity: z.infer<typeof semanticDecisionSchema>["entity"];
  message: string;
  session?: SemanticSessionContext;
}) {
  if (
    params.entity.type === "none" ||
    params.entity.type === "package" ||
    !isGroundedEntityName({ name: params.entity.name, message: params.message, session: params.session })
  ) {
    return undefined;
  }

  const entityId = `semantic_${createHash("sha256").update(`${params.entity.type}:${params.entity.name}`).digest("hex").slice(0, 16)}`;
  const common = {
    entityType: params.entity.type,
    entityId,
    displayName: params.entity.name.trim(),
  } as GreatTimeAgentEntityContext;

  if (params.entity.type === "customer") {
    return { ...common, customerName: params.entity.name.trim() };
  }
  if (params.entity.type === "service") {
    return { ...common, serviceName: params.entity.name.trim() };
  }
  if (params.entity.type === "practitioner") {
    return { ...common, practitionerName: params.entity.name.trim() };
  }
  if (params.entity.type === "invoice") {
    return { ...common, invoiceNumber: params.entity.name.trim() };
  }

  return common;
}

function buildToolPolicyCatalog(registry: Map<string, AgentToolDefinition>) {
  return (Object.keys(INTENTS_BY_AGENT) as GreatTimeAgentId[])
    .flatMap((agentId) =>
      INTENTS_BY_AGENT[agentId].map((intent) => {
        const tools = toolsForIntent(agentId, intent)
          .map((toolName) => {
            const tool = registry.get(toolName);
            return tool ? `${tool.name} (${tool.description})` : toolName;
          })
          .join("; ");
        return `- ${agentId}.${intent} => ${tools}`;
      }),
    )
    .join("\n");
}

function buildSemanticPrompt(params: {
  request: GreatTimeAgentChatRequest;
  deterministicPlan: GreatTimeAgentIntentPlan;
  session?: SemanticSessionContext;
  registry: Map<string, AgentToolDefinition>;
}) {
  const sessionContext = {
    activeTopic: params.session?.activeTopic ?? null,
    lastIntent: params.session?.lastIntent ?? null,
    recentEntities: (params.session?.entityRefs ?? []).slice(0, 8).map((ref) => ({
      type: ref.entityType,
      displayName: ref.displayName,
      rank: ref.rank,
    })),
  };

  return [
    "You are the semantic router for GreatTime, a clinic and beauty-service analytics assistant.",
    "Understand English, Myanmar, and mixed English-Myanmar. Classify meaning, not exact keywords.",
    "Return only the requested JSON. Never answer the business question and never invent identifiers.",
    "Definitions: a customer/member buys services or packages; a package has sessions that may be used or remain; a visit is completed attendance; an appointment/booking has an operational status; a practitioner/therapist/doctor performs treatments; sales are invoices while payments are collections.",
    "For a named customer's details, last visit, packages, remaining/unused sessions, therapist, payments, or history, choose customer_relationship.customer_360 unless the request asks only for purchase history.",
    "For a named service's full details choose business.service_360. For therapist performance choose business.practitioner_performance.",
    "For customers who purchased but never started, never visited, or never used a package, distinguish unactivated_purchase, package_bought_never_came, and package_bought_not_used according to the words used.",
    "Entity name must be copied exactly from the question or recent entity context. Use type=none and name='' when no specific entity is named.",
    `Requested agent: ${params.request.agent ?? "auto"}. A non-auto requested agent is a hard constraint.`,
    `Deterministic fallback candidate: ${params.deterministicPlan.resolvedAgent}.${params.deterministicPlan.intent}. Correct it only when the user's meaning clearly requires another supported intent.`,
    `Question: ${redactLongNumbers(params.request.message).slice(0, 1_000)}`,
    `Safe recent context: ${JSON.stringify(sessionContext)}`,
    "Supported intent-to-tool policy (the backend, not you, will select and authorize tools):",
    buildToolPolicyCatalog(params.registry),
  ].join("\n\n");
}

function estimateCostUsd(result: AiStructuredJsonResult) {
  const input = result.usage.promptTokens ?? 0;
  const output = result.usage.completionTokens ?? 0;
  if (!input && !output) {
    return undefined;
  }

  return Number(
    ((input / 1_000_000) * env.GEMINI_INPUT_COST_PER_MILLION_USD +
      (output / 1_000_000) * env.GEMINI_OUTPUT_COST_PER_MILLION_USD).toFixed(8),
  );
}

function validatePolicyTools(params: {
  agentId: GreatTimeAgentId;
  intent: string;
  plan: GreatTimeAgentIntentPlan;
  registry: Map<string, AgentToolDefinition>;
}) {
  const toolNames = toolsForIntent(params.agentId, params.intent, params.plan.period);
  const valid = toolNames.every((toolName) => {
    const tool = params.registry.get(toolName);
    return Boolean(
      tool &&
        tool.agentId === params.agentId &&
        (tool.capability === undefined || tool.capability === "read_only"),
    );
  });

  return valid ? toolNames : null;
}

export async function planSemanticAgentRequest(params: {
  request: GreatTimeAgentChatRequest;
  deterministicPlan: GreatTimeAgentIntentPlan;
  session?: SemanticSessionContext;
  provider?: AiJsonProvider | null;
  registry?: Map<string, AgentToolDefinition>;
}): Promise<SemanticPlannerResult> {
  const startedAt = Date.now();
  const fallback = (metadata: Omit<SemanticPlannerMetadata, "latencyMs" | "used">): SemanticPlannerResult => ({
    plan: params.deterministicPlan,
    metadata: {
      ...metadata,
      used: false,
      latencyMs: Date.now() - startedAt,
    },
  });

  // The Consultant preview uses deterministic, approved concern matching. Keep it
  // out of the general business semantic router until the customer-facing eval set is ready.
  if (params.deterministicPlan.resolvedAgent === "consultant") {
    return fallback({
      attempted: false,
      fallbackUsed: false,
      fallbackReason: "consultant_preview_deterministic",
    });
  }

  if (!env.AGENT_SEMANTIC_PLANNER_ENABLED || params.deterministicPlan.unsupportedReason) {
    return fallback({
      attempted: false,
      fallbackUsed: false,
      fallbackReason: env.AGENT_SEMANTIC_PLANNER_ENABLED ? "read_only_guard" : "disabled",
    });
  }

  const provider = params.provider === undefined ? createAiProvider() : params.provider;
  if (!provider) {
    return fallback({ attempted: false, fallbackUsed: true, fallbackReason: "provider_unavailable" });
  }

  const registry = params.registry ?? createAgentToolRegistry();

  try {
    const prompt = buildSemanticPrompt({
      request: params.request,
      deterministicPlan: params.deterministicPlan,
      session: params.session,
      registry,
    });
    const generated = provider.generateStructuredJson
      ? await provider.generateStructuredJson(prompt, {
          timeoutMs: env.AGENT_SEMANTIC_PLANNER_TIMEOUT_MS,
          modelName: env.AGENT_SEMANTIC_PLANNER_MODEL,
          responseSchema: SEMANTIC_RESPONSE_SCHEMA,
          temperature: 0,
          maxOutputTokens: env.AGENT_SEMANTIC_PLANNER_MAX_OUTPUT_TOKENS,
        })
      : {
          text: await provider.generateJson(prompt, { timeoutMs: env.AGENT_SEMANTIC_PLANNER_TIMEOUT_MS }),
          provider: "gemini" as const,
          modelName: provider.modelName,
          usage: {},
        };
    const parsed = semanticDecisionSchema.safeParse(JSON.parse(stripJsonFences(generated.text)));
    if (!parsed.success) {
      return fallback({
        attempted: true,
        fallbackUsed: true,
        fallbackReason: "invalid_structured_output",
        provider: generated.provider,
        model: generated.modelName,
        promptTokens: generated.usage.promptTokens,
        completionTokens: generated.usage.completionTokens,
        estimatedCostUsd: estimateCostUsd(generated),
      });
    }

    const decision = parsed.data;
    const hardAgent = params.request.agent && params.request.agent !== "auto" ? params.request.agent : null;
    if (hardAgent && decision.resolvedAgent !== hardAgent) {
      return fallback({
        attempted: true,
        fallbackUsed: true,
        fallbackReason: "requested_agent_mismatch",
        provider: generated.provider,
        model: generated.modelName,
        promptTokens: generated.usage.promptTokens,
        completionTokens: generated.usage.completionTokens,
        estimatedCostUsd: estimateCostUsd(generated),
        language: decision.language,
        confidence: decision.confidence,
      });
    }
    if (
      decision.confidence < env.AGENT_SEMANTIC_PLANNER_MIN_CONFIDENCE ||
      !INTENTS_BY_AGENT[decision.resolvedAgent].includes(decision.intent as never)
    ) {
      return fallback({
        attempted: true,
        fallbackUsed: true,
        fallbackReason:
          decision.confidence < env.AGENT_SEMANTIC_PLANNER_MIN_CONFIDENCE
            ? "low_confidence"
            : "agent_intent_mismatch",
        provider: generated.provider,
        model: generated.modelName,
        promptTokens: generated.usage.promptTokens,
        completionTokens: generated.usage.completionTokens,
        estimatedCostUsd: estimateCostUsd(generated),
        language: decision.language,
        confidence: decision.confidence,
      });
    }

    const semanticPeriod = applyIntentPeriodDefaults({
      resolvedAgent: decision.resolvedAgent,
      intent: decision.intent,
      request: params.request,
      period: params.deterministicPlan.period,
    });
    const toolNames = validatePolicyTools({
      agentId: decision.resolvedAgent,
      intent: decision.intent,
      plan: { ...params.deterministicPlan, period: semanticPeriod },
      registry,
    });
    if (!toolNames) {
      return fallback({
        attempted: true,
        fallbackUsed: true,
        fallbackReason: "tool_policy_rejected",
        provider: generated.provider,
        model: generated.modelName,
        promptTokens: generated.usage.promptTokens,
        completionTokens: generated.usage.completionTokens,
        estimatedCostUsd: estimateCostUsd(generated),
        language: decision.language,
        confidence: decision.confidence,
      });
    }

    const entityContext = semanticEntityContext({
      entity: decision.entity,
      message: params.request.message,
      session: params.session,
    });
    return {
      plan: {
        ...params.deterministicPlan,
        resolvedAgent: decision.resolvedAgent,
        autoMode: params.deterministicPlan.requestedAgent === "auto",
        intent: decision.intent,
        toolNames,
        period: semanticPeriod,
        semanticUnderstanding: {
          language: decision.language,
          confidence: decision.confidence,
          requestedFacts: decision.requestedFacts,
          ...(decision.entity.type !== "none"
            ? { entityType: decision.entity.type, entityName: decision.entity.name.trim() }
            : {}),
        },
      },
      entityContext,
      metadata: {
        attempted: true,
        used: true,
        fallbackUsed: false,
        latencyMs: Date.now() - startedAt,
        provider: generated.provider,
        model: generated.modelName,
        promptTokens: generated.usage.promptTokens,
        completionTokens: generated.usage.completionTokens,
        estimatedCostUsd: estimateCostUsd(generated),
        language: decision.language,
        confidence: decision.confidence,
      },
    };
  } catch {
    return fallback({
      attempted: true,
      fallbackUsed: true,
      fallbackReason: "provider_error_or_timeout",
      provider: "gemini",
      model: env.AGENT_SEMANTIC_PLANNER_MODEL,
    });
  }
}

export const __test = {
  INTENTS_BY_AGENT,
  SEMANTIC_RESPONSE_SCHEMA,
  isGroundedEntityName,
};
