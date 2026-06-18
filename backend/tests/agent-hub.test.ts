import assert from "node:assert/strict"
import test from "node:test"

process.env.APICORE_GRAPHQL_URL ??= "https://example.com/graphql"
process.env.AGENT_LEARNING_SCHEDULER_SECRET ??= "scheduler-secret"

const { normalizeAppointmentLifecycle } = await import("../src/services/agent-hub/appointment-lifecycle.ts")
const { resolveEntityReference } = await import("../src/services/agent-hub/entity-context.ts")
const { extractAgentPeriod, planAgentRequest } = await import("../src/services/agent-hub/intent-planner.ts")
const { buildAgentResponse } = await import("../src/services/agent-hub/response-builder.ts")
const { resolveAgent } = await import("../src/services/agent-hub/supervisor.ts")
const { assertToolAllowed } = await import("../src/services/agent-hub/tool-executor.ts")
const { createAgentToolRegistry, getAgentToolAllowlist } = await import("../src/services/agent-hub/tool-registry.ts")
const { isAgentLearningSchedulerSecretValid } = await import("../src/routes/agent-learning.routes.ts")

test("supervisor routes four agent domains and respects explicit override", () => {
  assert.equal(resolveAgent({ requestedAgent: "auto", message: "sales revenue by payment method" }).resolvedAgent, "finance")
  assert.equal(
    resolveAgent({ requestedAgent: "auto", message: "Which customers have unused package balance?" }).resolvedAgent,
    "customer_relationship",
  )
  assert.equal(resolveAgent({ requestedAgent: "auto", message: "service trend and practitioner performance" }).resolvedAgent, "business")
  assert.equal(resolveAgent({ requestedAgent: "auto", message: "How many appointments are checked in now?" }).resolvedAgent, "appointment")
  assert.equal(resolveAgent({ requestedAgent: "finance", message: "appointments today" }).resolvedAgent, "finance")
})

test("supervisor handles Myanmar keywords and deterministic tie-breaking", () => {
  assert.equal(resolveAgent({ requestedAgent: "auto", message: "ဒီနေ့ ငွေ ဘယ်လောက်ရလဲ" }).resolvedAgent, "finance")
  assert.equal(resolveAgent({ requestedAgent: "auto", message: "ဖောက်သည် package လက်ကျန်" }).resolvedAgent, "customer_relationship")
  assert.equal(resolveAgent({ requestedAgent: "auto", message: "appointment sales" }).resolvedAgent, "finance")
})

test("planner extracts relative periods and blocks write requests", () => {
  const now = new Date("2026-06-18T06:00:00.000Z")
  const period = extractAgentPeriod({
    message: "Compare this week sales with last week",
    timezone: "UTC",
    now,
  })
  assert.equal(period.fromDate, "2026-06-15")
  assert.equal(period.toDate, "2026-06-18")

  const plan = planAgentRequest({
    request: {
      clinicId: "clinic-1",
      clinicCode: "ABC",
      agent: "appointment",
      message: "Cancel the second appointment",
    },
    now,
  })
  assert.equal(plan.intent, "unsupported_write_request")
  assert.deepEqual(plan.toolNames, [])
})

test("appointment lifecycle does not claim treatment state from CHECKIN alone", () => {
  assert.deepEqual(normalizeAppointmentLifecycle({ rawStatus: "REQUEST" }), {
    state: "requested",
    stateConfidence: "confirmed",
  })
  assert.deepEqual(normalizeAppointmentLifecycle({ rawStatus: "BOOKED" }), {
    state: "booked",
    stateConfidence: "confirmed",
  })
  assert.deepEqual(normalizeAppointmentLifecycle({ rawStatus: "CHECKIN", inTime: "2026-06-18T02:00:00.000Z" }), {
    state: "arrived_start_unknown",
    stateConfidence: "inferred",
  })
  assert.deepEqual(normalizeAppointmentLifecycle({ rawStatus: "CHECKIN", treatmentStartedAt: "2026-06-18T02:05:00.000Z" }), {
    state: "treatment_in_progress",
    stateConfidence: "confirmed",
  })
  assert.deepEqual(normalizeAppointmentLifecycle({ rawStatus: "MERCHANT_CANCEL" }), {
    state: "cancelled",
    stateConfidence: "confirmed",
  })
  assert.deepEqual(normalizeAppointmentLifecycle({ rawStatus: "NO_SHOW" }), {
    state: "no_show",
    stateConfidence: "confirmed",
  })
})

test("tool registry enforces per-agent allowlists", () => {
  const registry = createAgentToolRegistry()
  assert.ok(getAgentToolAllowlist("finance", registry).includes("get_sales_summary"))
  assert.equal(assertToolAllowed({ requestedToolName: "get_sales_summary", agentId: "finance", registry }).name, "get_sales_summary")
  assert.throws(() => assertToolAllowed({ requestedToolName: "get_sales_summary", agentId: "appointment", registry }))
})

test("entity context resolves ordinal customer references", () => {
  const ref = resolveEntityReference({
    message: "Tell me about the second customer",
    sessionRefs: [
      { entityType: "customer", entityId: "c-1", displayName: "One", rank: 1 },
      { entityType: "customer", entityId: "c-2", displayName: "Two", rank: 2 },
    ],
  })
  assert.equal(ref?.entityId, "c-2")
})

test("response builder keeps tool metrics and source metadata grounded", () => {
  const response = buildAgentResponse({
    request: {
      clinicId: "clinic-1",
      clinicCode: "ABC",
      agent: "finance",
      message: "How much did we sell today?",
    },
    sessionId: "session-1",
    requestId: "request-1",
    plan: {
      requestedAgent: "finance",
      resolvedAgent: "finance",
      autoMode: false,
      intent: "sales_summary",
      toolNames: ["get_sales_summary"],
      period: { fromDate: "2026-06-18", toDate: "2026-06-18", label: "today" },
    },
    toolResults: [
      {
        toolName: "get_sales_summary",
        sourceName: "fixture",
        checkedAt: "2026-06-18T00:00:00.000Z",
        dataStatus: "ok",
        live: false,
        metrics: [{ label: "Total sales", value: 1200 }],
      },
    ],
  })

  assert.equal(response.metrics?.[0]?.value, 1200)
  assert.equal(response.sources[0]?.tool, "get_sales_summary")
  assert.equal(response.dataStatus, "ok")
  assert.equal(response.actions[0]?.type, "read_only_agent_response")
})

test("scheduler secret helper rejects missing or incorrect secrets", () => {
  assert.equal(isAgentLearningSchedulerSecretValid("scheduler-secret"), true)
  assert.equal(isAgentLearningSchedulerSecretValid("wrong"), false)
  assert.equal(isAgentLearningSchedulerSecretValid(undefined), false)
})
