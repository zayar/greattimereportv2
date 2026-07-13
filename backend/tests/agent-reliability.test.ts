import assert from "node:assert/strict";
import test from "node:test";

process.env.APICORE_GRAPHQL_URL ??= "https://example.com/graphql";

const { resolveEntityCandidates } = await import(
  "../src/services/agent-hub/entity-candidate-resolver.ts"
);
const { buildFactVerificationFallback, verifyAgentResponseFacts } = await import(
  "../src/services/agent-hub/fact-verifier.ts"
);

const candidates = [
  { id: "customer-1", name: "May Chit Thu", aliases: ["GT-100", "959111111"], value: { customerKey: "customer-1" } },
  { id: "customer-2", name: "May Chit Thu", aliases: ["GT-200", "959222222"], value: { customerKey: "customer-2" } },
  { id: "customer-3", name: "May Thiri", aliases: ["GT-300"], value: { customerKey: "customer-3" } },
];

test("central entity resolver requires clarification for duplicate exact names", () => {
  const resolution = resolveEntityCandidates({ query: "May Chit Thu", candidates });

  assert.equal(resolution.status, "ambiguous");
  if (resolution.status === "ambiguous") {
    assert.deepEqual(resolution.candidates.map((candidate) => candidate.id), ["customer-1", "customer-2"]);
    assert.equal(resolution.confidence, 1);
  }
});

test("central entity resolver uses a unique identifier and bounded fuzzy match", () => {
  const identifierResolution = resolveEntityCandidates({ query: "GT-200", candidates });
  assert.equal(identifierResolution.status, "resolved");
  if (identifierResolution.status === "resolved") {
    assert.equal(identifierResolution.candidate.id, "customer-2");
  }

  const fuzzyResolution = resolveEntityCandidates({ query: "May Thir", candidates });
  assert.equal(fuzzyResolution.status, "resolved");
  if (fuzzyResolution.status === "resolved") {
    assert.equal(fuzzyResolution.candidate.id, "customer-3");
    assert.equal(fuzzyResolution.matchType, "fuzzy");
  }
});

test("central entity resolver does not silently select an unrelated entity", () => {
  const resolution = resolveEntityCandidates({ query: "Completely Different", candidates });
  assert.equal(resolution.status, "not_found");
});

function groundedResponse() {
  return {
    sessionId: "session-1",
    requestId: "request-1",
    responseId: "response-1",
    requestedAgent: "auto" as const,
    resolvedAgent: "customer_relationship" as const,
    autoMode: true,
    intent: "customer_360",
    period: { fromDate: "2026-07-01", toDate: "2026-07-13", label: "this month" },
    assistantMessage: "May Chit Thu has 3 remaining sessions.",
    metrics: [{ label: "Remaining sessions", value: 3 }],
    sources: [
      {
        tool: "get_customer_360",
        sourceName: "BigQuery customer profile",
        checkedAt: "2026-07-13T06:00:00.000Z",
        dataStatus: "ok" as const,
      },
    ],
    dataStatus: "ok" as const,
    actions: [{ type: "read_only_agent_response" as const }],
  };
}

test("fact verifier accepts source-backed wording and rejects invented numbers", () => {
  const deterministicResponse = groundedResponse();
  const toolResults = [
    {
      toolName: "get_customer_360",
      sourceName: "BigQuery customer profile",
      checkedAt: "2026-07-13T06:00:00.000Z",
      dataStatus: "ok" as const,
      metrics: [{ label: "Remaining sessions", value: 3 }],
    },
  ];

  const grounded = verifyAgentResponseFacts({
    deterministicResponse,
    candidateResponse: { ...deterministicResponse, assistantMessage: "May Chit Thu still has 3 sessions." },
    toolResults,
  });
  assert.equal(grounded.passed, true);

  const invented = verifyAgentResponseFacts({
    deterministicResponse,
    candidateResponse: { ...deterministicResponse, assistantMessage: "May Chit Thu still has 99 sessions." },
    toolResults,
  });
  assert.equal(invented.passed, false);
  assert.ok(invented.issues.some((issue) => issue.code === "unsupported_number"));

  const fallback = buildFactVerificationFallback({ deterministicResponse });
  assert.equal(fallback.assistantMessage, deterministicResponse.assistantMessage);
  assert.ok(fallback.warnings?.some((warning) => warning.type === "answer_fact_verification_fallback"));
});

test("fact verifier rejects narrative changes to deterministic response facts", () => {
  const deterministicResponse = groundedResponse();
  const changedCore = {
    ...deterministicResponse,
    metrics: [{ label: "Remaining sessions", value: 4 }],
  };
  const result = verifyAgentResponseFacts({
    deterministicResponse,
    candidateResponse: changedCore,
    toolResults: [],
  });

  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.code === "core_response_changed"));
});
