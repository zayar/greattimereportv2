import assert from "node:assert/strict";
import test from "node:test";

process.env.APICORE_GRAPHQL_URL ??= "https://example.com/graphql";
process.env.AI_AGENT_MONITORING_ADMIN_EMAILS ??= "zayar@datafocus.cloud";

const {
  buildAiAgentMonitoringRunDetail,
  buildAiAgentMonitoringSummary,
  buildAiAgentMonitoringRuns,
  redactMonitoringText,
} = await import("../src/services/agent-hub/monitoring/agent-monitoring.service.ts");
const {
  isAiAgentMonitoringAdminEmail,
  parseAiAgentMonitoringAdminEmails,
  requireAiAgentMonitoringAdmin,
} = await import("../src/services/ai-agent-monitoring-access.service.ts");

function trace(overrides: Record<string, unknown>) {
  return {
    clinicId: "clinic-1",
    clinicCode: "GT",
    clinicName: "GT Clinic",
    userId: "user-1",
    userEmail: "staff@example.com",
    sessionId: "session-1",
    requestId: "run-1",
    responseId: "resp-1",
    requestedAgent: "appointment",
    resolvedAgent: "appointment",
    intent: "appointment_summary",
    toolNames: ["get_today_appointments"],
    sourceStatuses: ["ok"],
    dataStatus: "ok",
    channel: "web",
    status: "completed",
    totalLatencyMs: 1_000,
    createdAt: "2026-06-29T02:00:00.000Z",
    updatedAt: "2026-06-29T02:00:01.000Z",
    completedAt: "2026-06-29T02:00:01.000Z",
    ...overrides,
  };
}

test("AI Agent Monitoring allowlist only allows configured owner email", async () => {
  assert.equal(isAiAgentMonitoringAdminEmail("zayar@datafocus.cloud"), true);
  assert.equal(isAiAgentMonitoringAdminEmail(" ZAYAR@DataFocus.Cloud "), true);
  assert.equal(isAiAgentMonitoringAdminEmail("admin@example.com"), false);
  assert.equal(parseAiAgentMonitoringAdminEmails(" A@Example.com, b@example.com ").has("a@example.com"), true);

  await requireAiAgentMonitoringAdmin({
    path: "/ai/agent/monitoring/summary",
    query: {},
    user: {
      uid: "uid-zayar",
      email: "zayar@datafocus.cloud",
      roles: [],
      clinicIds: [],
    },
  } as never);

  await assert.rejects(
    () =>
      requireAiAgentMonitoringAdmin({
        path: "/ai/agent/monitoring/summary",
        query: {},
        user: {
          uid: "uid-admin",
          email: "admin@example.com",
          roles: ["admin"],
          clinicIds: ["clinic-1"],
        },
      } as never),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 403,
  );
});

test("monitoring summary counts running, completed, failed, timeout, and stuck runs", () => {
  const now = new Date("2026-06-29T02:05:00.000Z");
  const summary = buildAiAgentMonitoringSummary({
    range: "24h",
    now,
    learningRuns: [],
    feedbackEvents: [],
    recommendationOutcomes: [],
    insightCards: [],
    factSnapshots: [],
    traces: [
      trace({
        runId: "running-fresh",
        requestId: "running-fresh",
        responseId: "running-fresh",
        status: "running",
        updatedAt: "2026-06-29T02:04:30.000Z",
        completedAt: null,
      }),
      trace({ runId: "completed", requestId: "completed", responseId: "completed", status: "completed" }),
      trace({ runId: "failed", requestId: "failed", responseId: "failed", status: "failed", errorCategory: "tool_failed" }),
      trace({ runId: "timeout", requestId: "timeout", responseId: "timeout", status: "timeout", errorCategory: "tool_timeout" }),
      trace({
        runId: "stuck",
        requestId: "stuck",
        responseId: "stuck",
        status: "calling_tools",
        updatedAt: "2026-06-29T02:01:30.000Z",
        completedAt: null,
      }),
    ],
  });

  assert.equal(summary.summary.activeNow, 1);
  assert.equal(summary.summary.completedRuns, 1);
  assert.equal(summary.summary.failedRuns, 1);
  assert.equal(summary.summary.timeoutRuns, 1);
  assert.equal(summary.summary.stuckRuns, 1);
  assert.equal(summary.health, "critical");
});

test("monitoring tool metrics report slow and failing tools", () => {
  const summary = buildAiAgentMonitoringSummary({
    range: "24h",
    now: new Date("2026-06-29T02:05:00.000Z"),
    learningRuns: [],
    feedbackEvents: [],
    factSnapshots: [],
    traces: [
      trace({
        runId: "slow",
        requestId: "slow",
        responseId: "slow",
        toolExecutionResults: [
          { toolName: "get_today_appointments", latencyMs: 9_000, timedOut: false, dataStatus: "ok" },
        ],
      }),
      trace({
        runId: "failed-tool",
        requestId: "failed-tool",
        responseId: "failed-tool",
        resolvedAgent: "customer_relationship",
        toolExecutionResults: [
          { toolName: "customer_resolver", latencyMs: 120, timedOut: false, dataStatus: "unavailable", errorCategory: "tool_failed" },
        ],
      }),
    ],
  });

  assert.equal(summary.slowestTools[0]?.toolName, "get_today_appointments");
  assert.equal(summary.failingTools[0]?.toolName, "customer_resolver");
  assert.equal(summary.failingTools[0]?.failureCount, 1);
});

test("monitoring redaction masks phones emails tokens and truncates previews", () => {
  const redacted = redactMonitoringText(
    `Call 95912345061 or email owner@example.com. Authorization: Bearer abc.secret.token API_KEY=live-secret ${"x".repeat(700)}`,
    160,
  );

  assert.ok(redacted);
  assert.match(redacted!, /959\*\*\*\*061/);
  assert.match(redacted!, /ow\*\*\*@example\.com/);
  assert.doesNotMatch(redacted!, /abc\.secret\.token|live-secret/);
  assert.ok(redacted!.length <= 160);
});

test("run list computes stuck status and run detail returns sanitized timeline and tools", () => {
  const now = new Date("2026-06-29T02:05:00.000Z");
  const stuckTrace = trace({
    runId: "detail-run",
    requestId: "detail-run",
    responseId: "detail-response",
    status: "running",
    questionPreview: "Find customer 95912345061 token=secret",
    answerPreview: "Email owner@example.com for follow-up",
    sanitizedError: "Authorization: Bearer raw-token",
    updatedAt: "2026-06-29T02:00:00.000Z",
    completedAt: null,
    toolExecutionResults: [
      { toolName: "get_customer_360", latencyMs: 450, timedOut: false, dataStatus: "ok" },
    ],
  });
  const runs = buildAiAgentMonitoringRuns({ traces: [stuckTrace], now });
  const detail = buildAiAgentMonitoringRunDetail({
    trace: stuckTrace as never,
    feedbackEvents: [
      {
        id: "feedback-1",
        clinicId: "clinic-1",
        userId: "user-1",
        sessionId: "session-1",
        requestId: "detail-run",
        responseId: "detail-response",
        feedbackType: "wrong_data",
        rating: "not_helpful",
        note: "Phone 95912345061 was wrong",
        createdAt: "2026-06-29T02:04:00.000Z",
      },
    ] as never,
    now,
  });

  assert.equal(runs.rows[0]?.status, "stuck");
  assert.match(detail.run.questionPreview ?? "", /959\*\*\*\*061/);
  assert.doesNotMatch(detail.run.sanitizedError ?? "", /raw-token/);
  assert.equal(detail.run.tools[0]?.toolName, "get_customer_360");
  assert.equal(detail.feedback[0]?.feedbackType, "wrong_data");
});

test("telegram delivery failures increment monitoring summary", () => {
  const summary = buildAiAgentMonitoringSummary({
    range: "24h",
    now: new Date("2026-06-29T02:05:00.000Z"),
    learningRuns: [],
    feedbackEvents: [],
    factSnapshots: [],
    traces: [
      trace({
        runId: "telegram-fail",
        requestId: "telegram-fail",
        responseId: "telegram-fail",
        channel: "telegram",
        status: "failed",
        telegramDeliveryStatus: "failed",
        errorCategory: "telegram_send_failed",
      }),
    ],
  });

  assert.equal(summary.summary.telegramDeliveryFailureCount, 1);
  assert.equal(summary.alerts[0]?.code, "telegram_delivery_failed");
});
