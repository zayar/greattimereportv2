import { createAiProvider } from "../../ai/provider.js";
import type { AiJsonProvider } from "../../ai/provider.js";
import { planAgentRequest } from "../intent-planner.js";
import { planSemanticAgentRequest } from "../semantic-planner.js";
import type { GreatTimeAgentChatRequest } from "../types.js";
import { AGENT_EVAL_CASES, AGENT_EVAL_DATASET_VERSION, type AgentEvaluationCase } from "./agent-eval-cases.v1.js";

export type AgentEvaluationFailure = {
  id: string;
  question: string;
  fields: string[];
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
};

export type AgentEvaluationReport = {
  datasetVersion: string;
  mode: "deterministic" | "semantic";
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  minimumPassRate: number;
  passedThreshold: boolean;
  byCategory: Record<string, { total: number; passed: number; failed: number }>;
  semanticFallbackCount: number;
  estimatedCostUsd: number;
  failures: AgentEvaluationFailure[];
};

function requestForCase(testCase: AgentEvaluationCase): GreatTimeAgentChatRequest {
  return {
    clinicId: "agent-evaluation-clinic",
    clinicCode: "EVAL",
    agent: testCase.requestedAgent ?? "auto",
    message: testCase.question,
    aiLanguage: testCase.language === "my" ? "my-MM" : "en-US",
    timezone: "Asia/Yangon",
  };
}

function sameStrings(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export async function runAgentEvaluations(params?: {
  cases?: AgentEvaluationCase[];
  semantic?: boolean;
  provider?: AiJsonProvider | null;
  concurrency?: number;
  minimumPassRate?: number;
}) {
  const cases = params?.cases ?? AGENT_EVAL_CASES;
  const semantic = params?.semantic ?? false;
  const provider = semantic ? (params?.provider === undefined ? createAiProvider() : params.provider) : null;
  if (semantic && !provider) {
    throw new Error("Semantic evaluation requires GEMINI_API_KEY or an injected AI provider.");
  }

  const concurrency = Math.min(Math.max(params?.concurrency ?? (semantic ? 4 : 20), 1), 10);
  const failures: AgentEvaluationFailure[] = [];
  const byCategory: AgentEvaluationReport["byCategory"] = {};
  let semanticFallbackCount = 0;
  let estimatedCostUsd = 0;

  for (let offset = 0; offset < cases.length; offset += concurrency) {
    const batch = cases.slice(offset, offset + concurrency);
    const results = await Promise.all(
      batch.map(async (testCase) => {
        const request = requestForCase(testCase);
        const deterministicPlan = planAgentRequest({ request, now: new Date("2026-07-13T06:00:00.000Z") });
        const semanticResult = semantic
          ? await planSemanticAgentRequest({ request, deterministicPlan, provider })
          : null;
        const plan = semanticResult?.plan ?? deterministicPlan;
        const actualEntityType = plan.semanticUnderstanding?.entityType;
        const actualEntityName = plan.semanticUnderstanding?.entityName;
        const fields: string[] = [];
        if (plan.resolvedAgent !== testCase.expectedAgent) fields.push("resolvedAgent");
        if (plan.intent !== testCase.expectedIntent) fields.push("intent");
        if (!sameStrings(plan.toolNames, testCase.expectedTools)) fields.push("toolNames");
        if (semantic && testCase.expectedEntityType && actualEntityType !== testCase.expectedEntityType) fields.push("entityType");
        if (semantic && testCase.expectedEntityName && actualEntityName !== testCase.expectedEntityName) fields.push("entityName");

        return { testCase, plan, semanticResult, actualEntityType, actualEntityName, fields };
      }),
    );

    results.forEach(({ testCase, plan, semanticResult, actualEntityType, actualEntityName, fields }) => {
      const category = (byCategory[testCase.category] ??= { total: 0, passed: 0, failed: 0 });
      category.total += 1;
      if (semanticResult?.metadata.fallbackUsed) semanticFallbackCount += 1;
      estimatedCostUsd += semanticResult?.metadata.estimatedCostUsd ?? 0;

      if (fields.length === 0) {
        category.passed += 1;
        return;
      }
      category.failed += 1;
      failures.push({
        id: testCase.id,
        question: testCase.question,
        fields,
        expected: {
          resolvedAgent: testCase.expectedAgent,
          intent: testCase.expectedIntent,
          toolNames: testCase.expectedTools,
          entityType: testCase.expectedEntityType,
          entityName: testCase.expectedEntityName,
        },
        actual: {
          resolvedAgent: plan.resolvedAgent,
          intent: plan.intent,
          toolNames: plan.toolNames,
          entityType: actualEntityType,
          entityName: actualEntityName,
          semanticFallbackReason: semanticResult?.metadata.fallbackReason,
        },
      });
    });
  }

  const passed = cases.length - failures.length;
  const passRate = cases.length ? passed / cases.length : 0;
  const minimumPassRate = params?.minimumPassRate ?? (semantic ? 0.9 : 0.7);
  const report: AgentEvaluationReport = {
    datasetVersion: AGENT_EVAL_DATASET_VERSION,
    mode: semantic ? "semantic" : "deterministic",
    total: cases.length,
    passed,
    failed: failures.length,
    passRate,
    minimumPassRate,
    passedThreshold: passRate >= minimumPassRate,
    byCategory,
    semanticFallbackCount,
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)),
    failures,
  };
  return report;
}
