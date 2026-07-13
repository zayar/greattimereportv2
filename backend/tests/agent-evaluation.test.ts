import assert from "node:assert/strict";
import test from "node:test";

process.env.APICORE_GRAPHQL_URL ??= "https://example.com/graphql";

const { AGENT_EVAL_CASES, AGENT_EVAL_DATASET_VERSION } = await import(
  "../src/services/agent-hub/evaluation/agent-eval-cases.v1.ts"
);
const { runAgentEvaluations } = await import(
  "../src/services/agent-hub/evaluation/run-agent-evals.ts"
);

test("Agent Hub evaluation dataset v1 contains exactly 100 uniquely identified questions", () => {
  assert.equal(AGENT_EVAL_DATASET_VERSION, "1.0.0");
  assert.equal(AGENT_EVAL_CASES.length, 100);
  assert.equal(new Set(AGENT_EVAL_CASES.map((item) => item.id)).size, 100);
  assert.equal(new Set(AGENT_EVAL_CASES.map((item) => item.question)).size, 100);
});

test("Agent Hub deterministic fallback stays above its versioned 100-question baseline", async () => {
  const report = await runAgentEvaluations({ semantic: false });
  assert.equal(report.total, 100);
  assert.equal(report.passedThreshold, true, JSON.stringify(report.failures, null, 2));
  assert.ok(report.passRate >= 0.7);
});
