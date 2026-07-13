import type { AgentToolResult, GreatTimeAgentChatResponse, GreatTimeAgentWarning } from "./types.js";

export type AgentFactVerificationIssue = {
  code: "unsupported_number" | "core_response_changed" | "missing_source_attribution";
  detail: string;
};

export type AgentFactVerificationResult = {
  passed: boolean;
  issues: AgentFactVerificationIssue[];
  checkedNumericFacts: string[];
};

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return '"__undefined__"';
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

function normalizeNumericFact(value: string) {
  const compact = value.replace(/,/g, "").replace(/%$/, "");
  const numeric = Number(compact);
  return Number.isFinite(numeric) ? String(numeric) : compact;
}

export function extractNumericFacts(value: string) {
  const matches = value.match(/[-+]?\d[\d,]*(?:\.\d+)?%?/g) ?? [];
  return [...new Set(matches.map(normalizeNumericFact))];
}

function immutableResponseCore(response: GreatTimeAgentChatResponse) {
  return {
    sessionId: response.sessionId,
    requestId: response.requestId,
    responseId: response.responseId,
    requestedAgent: response.requestedAgent,
    resolvedAgent: response.resolvedAgent,
    autoMode: response.autoMode,
    intent: response.intent,
    period: response.period,
    metrics: response.metrics,
    tables: response.tables,
    data: response.data,
    customer360: response.customer360,
    service360: response.service360,
    sources: response.sources,
    dataStatus: response.dataStatus,
    clarification: response.clarification,
    entityContext: response.entityContext,
    entityRefs: response.entityRefs,
    actions: response.actions,
  };
}

export function verifyAgentResponseFacts(params: {
  deterministicResponse: GreatTimeAgentChatResponse;
  candidateResponse: GreatTimeAgentChatResponse;
  toolResults: AgentToolResult[];
}): AgentFactVerificationResult {
  const issues: AgentFactVerificationIssue[] = [];
  if (
    stableStringify(immutableResponseCore(params.deterministicResponse)) !==
    stableStringify(immutableResponseCore(params.candidateResponse))
  ) {
    issues.push({
      code: "core_response_changed",
      detail: "Narrative processing changed source-grounded response fields.",
    });
  }

  const evidencePayload = stableStringify({
    toolResults: params.toolResults,
    deterministicResponse: params.deterministicResponse,
  });
  const evidenceNumbers = new Set(extractNumericFacts(evidencePayload));
  const candidateNumbers = extractNumericFacts(params.candidateResponse.assistantMessage);
  candidateNumbers.forEach((numericFact) => {
    if (!evidenceNumbers.has(numericFact)) {
      issues.push({
        code: "unsupported_number",
        detail: `The generated wording introduced an unsupported numeric fact: ${numericFact}.`,
      });
    }
  });

  if (
    params.candidateResponse.dataStatus === "ok" &&
    params.candidateResponse.sources.length === 0 &&
    (params.candidateResponse.metrics?.length || params.candidateResponse.tables?.some((table) => table.rows.length))
  ) {
    issues.push({
      code: "missing_source_attribution",
      detail: "A factual response was marked current without source attribution.",
    });
  }

  return {
    passed: issues.length === 0,
    issues,
    checkedNumericFacts: candidateNumbers,
  };
}

export function buildFactVerificationFallback(params: {
  deterministicResponse: GreatTimeAgentChatResponse;
  usedMemoryIds?: string[];
}) {
  const warning: GreatTimeAgentWarning = {
    type: "answer_fact_verification_fallback",
    title: "Verified deterministic wording used",
    message: "AI wording did not pass source-grounded fact verification, so the deterministic answer was returned.",
  };

  return {
    ...params.deterministicResponse,
    usedMemoryIds: params.usedMemoryIds,
    warnings: [...(params.deterministicResponse.warnings ?? []), warning],
  };
}
