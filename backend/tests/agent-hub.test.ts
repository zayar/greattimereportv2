import assert from "node:assert/strict"
import test from "node:test"

process.env.APICORE_GRAPHQL_URL ??= "https://example.com/graphql"
process.env.AGENT_LEARNING_SCHEDULER_SECRET ??= "scheduler-secret"

const { normalizeAppointmentLifecycle } = await import("../src/services/agent-hub/appointment-lifecycle.ts")
const { isActiveCheckedInAppointment, isCountableTodayAppointment } = await import("../src/services/agent-hub/appointment-live.service.ts")
const { composeCustomer360Summary } = await import("../src/services/agent-hub/customer-360.service.ts")
const { resolveEntityReference } = await import("../src/services/agent-hub/entity-context.ts")
const { extractAgentPeriod, planAgentRequest } = await import("../src/services/agent-hub/intent-planner.ts")
const { buildAgentResponse } = await import("../src/services/agent-hub/response-builder.ts")
const { resolveAgent } = await import("../src/services/agent-hub/supervisor.ts")
const { assertToolAllowed } = await import("../src/services/agent-hub/tool-executor.ts")
const { createAgentToolRegistry, getAgentToolAllowlist } = await import("../src/services/agent-hub/tool-registry.ts")
const { extractInvoiceSearch } = await import("../src/services/agent-hub/tools/finance.tools.ts")
const {
  buildLockedAgentHubResponse,
  extractExplicitCustomerSearchText,
  shouldIgnoreExplicitEntityContext,
} = await import("../src/services/agent-hub/agent-hub.service.ts")
const { evaluateMemoryCandidate, buildMemoryRecord } = await import("../src/services/agent-hub/memory/memory-policy.ts")
const { rankMemoriesForRequest } = await import("../src/services/agent-hub/memory/memory-retriever.ts")
const { buildMemoryRecordsFromFeedbackEvents } = await import("../src/services/agent-hub/memory/memory-writer.ts")
const { buildSessionSummaryFromTurn, isSessionSummaryFresh } = await import("../src/services/agent-hub/session.repository.ts")
const { buildLearningBucket, isScheduleDueForJob } = await import("../src/services/agent-hub/learning-worker.ts")
const { isAgentLearningSchedulerSecretValid } = await import("../src/routes/agent-learning.routes.ts")
const {
  canTelegramUserChatWithAgent,
  extractTelegramAgentQuestion,
  formatAgentHubTelegramReply,
} = await import("../src/services/telegram/bot.service.ts")

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

  const collectPlan = planAgentRequest({
    request: {
      clinicId: "clinic-1",
      clinicCode: "ABC",
      agent: "finance",
      message: "Please collect payment from the first customer",
    },
    now,
  })
  assert.equal(collectPlan.intent, "unsupported_write_request")
  assert.deepEqual(collectPlan.toolNames, [])
})

test("planner does not block read-only questions that mention collected or cancelled data", () => {
  const now = new Date("2026-06-18T06:00:00.000Z")

  const paymentPlan = planAgentRequest({
    request: {
      clinicId: "clinic-1",
      clinicCode: "ABC",
      agent: "auto",
      message: "How much did we collect today by payment method?",
    },
    now,
  })
  assert.equal(paymentPlan.resolvedAgent, "finance")
  assert.equal(paymentPlan.intent, "payment_method_breakdown")
  assert.deepEqual(paymentPlan.toolNames, ["get_payment_summary", "get_payment_method_breakdown"])

  const appointmentPlan = planAgentRequest({
    request: {
      clinicId: "clinic-1",
      clinicCode: "ABC",
      agent: "appointment",
      message: "Show cancelled and no-show appointments today",
    },
    now,
  })
  assert.equal(appointmentPlan.intent, "cancelled_no_show")
  assert.deepEqual(appointmentPlan.toolNames, ["get_cancelled_no_show_customers"])
})

test("planner routes exact named customer briefings to one-shot Customer 360", () => {
  const plan = planAgentRequest({
    request: {
      clinicId: "clinic-1",
      clinicCode: "ABC",
      agent: "auto",
      message: "Tell me about Soe Moe Thu",
    },
    now: new Date("2026-06-18T06:00:00.000Z"),
  })

  assert.equal(plan.resolvedAgent, "customer_relationship")
  assert.equal(plan.intent, "customer_360")
  assert.deepEqual(plan.toolNames, ["get_customer_360"])

  const showPlan = planAgentRequest({
    request: {
      clinicId: "clinic-1",
      clinicCode: "ABC",
      agent: "auto",
      message: "Show Soe Moe Thu",
    },
    now: new Date("2026-06-18T06:00:00.000Z"),
  })

  assert.equal(showPlan.resolvedAgent, "customer_relationship")
  assert.equal(showPlan.intent, "customer_360")
  assert.deepEqual(showPlan.toolNames, ["get_customer_360"])
})

test("planner keeps generic show questions out of Customer 360 and includes usage in overview", () => {
  const appointmentPlan = planAgentRequest({
    request: {
      clinicId: "clinic-1",
      clinicCode: "ABC",
      agent: "auto",
      message: "Show all appointments today",
    },
  })
  assert.equal(appointmentPlan.resolvedAgent, "appointment")

  const overviewPlan = planAgentRequest({
    request: {
      clinicId: "clinic-1",
      clinicCode: "ABC",
      agent: "customer_relationship",
      message: "Show customer history, package, purchase, and payment detail",
    },
  })

  assert.equal(overviewPlan.intent, "customer_overview")
  assert.ok(overviewPlan.toolNames.includes("get_customer_usage"))
})

test("invoice detail search ignores generic time and display words", () => {
  assert.equal(extractInvoiceSearch("Show today invoice detail."), "")
  assert.equal(extractInvoiceSearch("Show invoice ABC-12345 detail"), "ABC-12345")
  assert.equal(extractInvoiceSearch("Show invoice detail for Aung Aung"), "Aung Aung")
})

test("customer follow-up ignores stale entity context when a different explicit name is requested", () => {
  const shweContext = {
    entityType: "customer" as const,
    entityId: "customer:shwe",
    customerKey: "customer:shwe",
    displayName: "Shwe Myat Thu",
    customerName: "Shwe Myat Thu",
    rank: 1,
  }

  assert.equal(extractExplicitCustomerSearchText("can you find Sumar Tun"), "Sumar Tun")
  assert.equal(extractExplicitCustomerSearchText("what about May Thu Q"), "May Thu Q")
  assert.equal(
    shouldIgnoreExplicitEntityContext({
      request: {
        clinicId: "clinic-1",
        clinicCode: "ABC",
        agent: "customer_relationship",
        message: "can you find Sumar Tun",
        entityContext: shweContext,
      },
    }),
    true,
  )
  assert.equal(
    shouldIgnoreExplicitEntityContext({
      request: {
        clinicId: "clinic-1",
        clinicCode: "ABC",
        agent: "customer_relationship",
        message: "Show me details about Shwe Myat Thu",
        entityContext: shweContext,
      },
    }),
    false,
  )
})

test("planner maps checked-in appointment questions to active check-in rows", () => {
  const plan = planAgentRequest({
    request: {
      clinicId: "clinic-1",
      clinicCode: "ABC",
      agent: "auto",
      message: "How many appointments are checked in right now?",
    },
  })

  assert.equal(plan.resolvedAgent, "appointment")
  assert.equal(plan.intent, "checked_in_customers")
  assert.deepEqual(plan.toolNames, ["get_checked_in_customers"])
})

test("planner maps general appointment questions to the APICORE appointment ledger", () => {
  const countPlan = planAgentRequest({
    request: {
      clinicId: "clinic-1",
      clinicCode: "ABC",
      agent: "appointment",
      message: "How many appointments today?",
    },
  })
  assert.equal(countPlan.intent, "appointment_summary")
  assert.deepEqual(countPlan.toolNames, ["get_appointment_ledger"])

  const listPlan = planAgentRequest({
    request: {
      clinicId: "clinic-1",
      clinicCode: "ABC",
      agent: "appointment",
      message: "List all appointments today",
    },
  })
  assert.equal(listPlan.intent, "appointment_list")
  assert.deepEqual(listPlan.toolNames, ["get_appointment_ledger"])
})

test("planner maps treatment-start appointment questions to the APICORE status proxy", () => {
  const plan = planAgentRequest({
    request: {
      clinicId: "clinic-1",
      clinicCode: "ABC",
      agent: "appointment",
      message: "Which customers may not have started treatment?",
    },
  })

  assert.equal(plan.intent, "waiting_customers")
  assert.deepEqual(plan.toolNames, ["get_treatment_start_proxy"])
})

test("Telegram Agent chat helpers require explicit group commands and target permission", () => {
  assert.equal(extractTelegramAgentQuestion("/ask How much did we collect today?", "group"), "How much did we collect today?")
  assert.equal(extractTelegramAgentQuestion("How much did we collect today?", "group"), null)
  assert.equal(extractTelegramAgentQuestion("How much did we collect today?", "private"), "How much did we collect today?")

  assert.equal(
    canTelegramUserChatWithAgent({
      target: {
        isAgentChatEnabled: false,
        agentChatAccessMode: "all_members",
        agentChatAllowedUserIds: [],
      },
      telegramUserId: "12345",
    }),
    false,
  )
  assert.equal(
    canTelegramUserChatWithAgent({
      target: {
        isAgentChatEnabled: true,
        agentChatAccessMode: "allowed_users",
        agentChatAllowedUserIds: ["12345"],
      },
      telegramUserId: "12345",
    }),
    true,
  )
  assert.equal(
    canTelegramUserChatWithAgent({
      target: {
        isAgentChatEnabled: true,
        agentChatAccessMode: "allowed_users",
        agentChatAllowedUserIds: ["12345"],
      },
      telegramUserId: "99999",
    }),
    false,
  )
})

test("Telegram Agent reply formatter keeps summaries, metrics, previews, and sources", () => {
  const message = formatAgentHubTelegramReply({
    sessionId: "session-1",
    requestId: "request-1",
    responseId: "response-1",
    requestedAgent: "auto",
    resolvedAgent: "finance",
    autoMode: true,
    intent: "payment_summary",
    assistantMessage: "Collections for today: 10,000 across 2 invoices.",
    summary: "Collections for today: 10,000 across 2 invoices.",
    metrics: [{ label: "Collected", value: 10000, unit: "amount" }],
    tables: [
      {
        title: "Payment methods",
        columns: [
          { key: "method", title: "Method" },
          { key: "amount", title: "Amount" },
        ],
        rows: [{ method: "CASH", amount: 10000 }],
      },
    ],
    followUpQuestions: ["Show payment methods by amount."],
    sources: [
      {
        tool: "get_payment_summary",
        sourceName: "BigQuery payment report",
        checkedAt: "2026-06-23T00:00:00.000Z",
        dataStatus: "ok",
        live: false,
      },
    ],
    dataStatus: "ok",
    actions: [{ type: "read_only_agent_response" }],
  })

  assert.match(message, /GT Agent/)
  assert.match(message, /Collected: 10,000 amount/)
  assert.match(message, /Payment methods/)
  assert.match(message, /BigQuery payment report: ok/)
  assert.match(message, /\/ask Show payment methods by amount/)
})

test("appointment helpers count active checked-ins and exclude merchant cancellations from totals", () => {
  assert.equal(
    isActiveCheckedInAppointment({
      checkInTime: "2026-06-18T08:00:00.000Z",
      checkOutTime: null,
      lifecycleState: "arrived_start_unknown",
      rawStatus: "CHECKIN",
    }),
    true,
  )
  assert.equal(
    isActiveCheckedInAppointment({
      checkInTime: "2026-06-18T08:00:00.000Z",
      checkOutTime: "2026-06-18T09:00:00.000Z",
      lifecycleState: "checked_out",
      rawStatus: "CHECKOUT",
    }),
    false,
  )
  assert.equal(isCountableTodayAppointment({ rawStatus: "MERCHANT_CANCEL" }), false)
  assert.equal(isCountableTodayAppointment({ rawStatus: "MEMBER_CANCEL" }), true)
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

test("response builder exposes Customer 360 fact packs with scoped sources and dynamic follow-ups", () => {
  const customer360 = {
    identity: {
      customerKey: "cust-1",
      displayName: "Soe Moe Thu",
      joinedDate: "2021-07-03",
      maskedPhone: "09***123",
    },
    value: {
      lifetimeSpend: 360500000,
      totalVisits: 805,
      averageVisitSpend: 447826.09,
    },
    latestActivity: {
      lastVisitAt: "2026-06-22",
      lastService: "Body Contouring",
      lastTherapist: "Htet Htet",
      daysSinceLastVisit: 2,
    },
    preferences: {
      preferredService: "Body Contouring",
      preferredServiceCategory: "Body",
      preferredTherapist: "Htet Htet",
      preferredTherapistVisits: 200,
    },
    visitPattern: {
      averageVisitIntervalDays: 2.3,
      recentWindowVisits: 40,
      previousWindowVisits: 49,
      momentum: "declining" as const,
    },
    packages: {
      purchaseCount: 2,
      activeHoldingCount: 1,
      totalRemainingSessions: 5,
      dataStatus: "ok" as const,
      holdings: [
        {
          packageId: "pkg-1",
          packageName: "Body Package",
          serviceName: "Body Contouring",
          totalSessions: 10,
          usedSessions: 5,
          remainingSessions: 5,
          latestUsageDate: "2026-06-22",
          latestTherapist: "Htet Htet",
          status: "active" as const,
        },
      ],
    },
    appointments: {
      current: [],
      upcoming: [],
      recentCompleted: [{ checkInTime: "2026-06-22", serviceName: "Body Contouring" }],
    },
    payments: {
      selectedPeriodTotal: 200000000,
      invoiceCount: 3,
      averageInvoice: 66666666.67,
      outstanding: 0,
      preferredMethod: "KBZ",
      recentInvoices: [{ invoiceNumber: "INV-1", netAmount: 200000000 }],
    },
    usage: {
      selectedYear: 2026,
      distinctServices: 1,
      topServices: [{ serviceName: "Body Contouring", totalUsage: 40 }],
      monthlyServiceUsage: [{ serviceName: "Body Contouring", month: "Jun", usageCount: 10 }],
    },
    recommendation: {
      title: "Rebook unused package care",
      reasonCodes: ["unused_package_balance", "no_live_upcoming_booking"],
      evidence: ["5 remaining package sessions", "No upcoming booking found."],
    },
    dataQuality: [],
    sources: [
      {
        tool: "get_customer_overview",
        sourceName: "BigQuery customer portal",
        checkedAt: "2026-06-24T00:00:00.000Z",
        dataStatus: "ok" as const,
        live: false,
        scope: "historical" as const,
      },
      {
        tool: "get_customer_live_appointments",
        sourceName: "APICORE booking ledger",
        checkedAt: "2026-06-24T00:00:00.000Z",
        dataStatus: "no_activity" as const,
        live: true,
        scope: "live" as const,
      },
    ],
  }
  const response = buildAgentResponse({
    request: {
      clinicId: "clinic-1",
      clinicCode: "ABC",
      agent: "customer_relationship",
      message: "Tell me about Soe Moe Thu",
    },
    sessionId: "session-1",
    requestId: "request-1",
    plan: {
      requestedAgent: "customer_relationship",
      resolvedAgent: "customer_relationship",
      autoMode: false,
      intent: "customer_360",
      toolNames: ["get_customer_360"],
      period: { fromDate: "2026-06-01", toDate: "2026-06-24", label: "selected period" },
    },
    toolResults: [
      {
        toolName: "get_customer_360",
        sourceName: "Customer 360 fact pack",
        checkedAt: "2026-06-24T00:00:00.000Z",
        dataStatus: "ok",
        live: true,
        summary: composeCustomer360Summary(customer360),
        customer360,
        sources: customer360.sources,
      },
    ],
  })

  assert.equal(response.customer360?.identity.displayName, "Soe Moe Thu")
  assert.equal(response.sources[0]?.scope, "historical")
  assert.ok(response.followUpQuestions?.includes("Show her unused package services."))
  assert.ok(response.followUpQuestions?.includes("Show purchase and payment details."))
  assert.ok(response.assistantMessage.includes("805 visits"))
})

test("Customer 360 deterministic summary avoids exact package totals when the package section is partial", () => {
  const summary = composeCustomer360Summary({
    identity: {
      customerKey: "cust-1",
      displayName: "Soe Moe Thu",
      joinedDate: "2021-07-03",
    },
    value: {
      lifetimeSpend: 360500000,
      totalVisits: 805,
    },
    latestActivity: {
      lastVisitAt: "2026-06-22",
      lastService: "Body Contouring",
      lastTherapist: "Htet Htet",
      daysSinceLastVisit: 2,
    },
    preferences: {
      preferredService: "Body Contouring",
      preferredTherapist: "Htet Htet",
    },
    visitPattern: {
      recentWindowVisits: 40,
      previousWindowVisits: 49,
      momentum: "declining",
    },
    packages: {
      dataStatus: "partial",
      holdings: [],
    },
    appointments: {
      current: [],
      upcoming: [],
      recentCompleted: [],
    },
    payments: {
      recentInvoices: [],
    },
    usage: {
      topServices: [],
      monthlyServiceUsage: [],
    },
    dataQuality: [
      {
        code: "package_contract_missing",
        severity: "warning",
        message: "Package holding identity is unavailable.",
      },
    ],
    sources: [],
  })

  assert.match(summary, /not presented as an exact combined total/)
  assert.doesNotMatch(summary, /undefined remaining/)
})

test("response builder assigns stable recommendation IDs", () => {
  const baseParams = {
    request: {
      clinicId: "clinic-1",
      clinicCode: "ABC",
      agent: "customer_relationship" as const,
      message: "Show unused package opportunities",
    },
    sessionId: "session-1",
    requestId: "request-1",
    plan: {
      requestedAgent: "customer_relationship" as const,
      resolvedAgent: "customer_relationship" as const,
      autoMode: false,
      intent: "unused_package_balance",
      toolNames: ["search_customer_profiles"],
      period: { fromDate: "2026-06-18", toDate: "2026-06-18", label: "today" },
    },
    toolResults: [
      {
        toolName: "search_customer_profiles",
        sourceName: "profiles",
        checkedAt: "2026-06-18T00:00:00.000Z",
        dataStatus: "ok" as const,
        live: false,
        recommendations: [{ title: "Unused package", message: "Follow up unused package customers.", sourceTools: ["search_customer_profiles"] }],
      },
    ],
  }
  const first = buildAgentResponse(baseParams)
  const second = buildAgentResponse(baseParams)

  assert.ok(first.recommendations?.[0]?.recommendationId?.startsWith("rec_"))
  assert.equal(first.recommendations?.[0]?.recommendationId, second.recommendations?.[0]?.recommendationId)
})

test("memory policy rejects missing scope, transient exact metrics, secrets, and PII", () => {
  assert.equal(
    evaluateMemoryCandidate({
      clinicId: "",
      memoryType: "response_style",
      content: "Owner prefers concise answers.",
      source: "explicit_user",
    }).accepted,
    false,
  )
  assert.equal(
    evaluateMemoryCandidate({
      clinicId: "clinic-1",
      memoryType: "clinic_pattern",
      content: "Today sales are 500,000 MMK.",
      source: "system_observed",
    }).accepted,
    false,
  )
  assert.equal(
    evaluateMemoryCandidate({
      clinicId: "clinic-1",
      memoryType: "response_style",
      content: "Bearer abc.def.ghi",
      source: "explicit_user",
    }).accepted,
    false,
  )
  assert.equal(
    evaluateMemoryCandidate({
      clinicId: "clinic-1",
      memoryType: "entity_pattern",
      content: "Customer phone is 09999999999.",
      source: "system_observed",
    }).accepted,
    false,
  )
})

test("memory policy activates explicit preferences and promotes repeated evidence", () => {
  const explicit = buildMemoryRecord({
    clinicId: "clinic-1",
    userId: "user-1",
    memoryType: "response_style",
    content: "Owner prefers concise answers.",
    source: "explicit_user",
  })
  assert.equal(explicit?.status, "active")
  assert.ok((explicit?.confidence ?? 0) > 0.9)

  const repeated = buildMemoryRecord({
    clinicId: "clinic-1",
    userId: "user-1",
    memoryType: "response_style",
    content: "Owner often marks responses too long; prefer concise answers for this area.",
    source: "feedback",
    evidenceCount: 2,
  })
  assert.equal(repeated?.status, "active")
})

test("feedback learning extracts explicit and repeated preference memories", () => {
  const records = buildMemoryRecordsFromFeedbackEvents([
    {
      id: "fb-1",
      clinicId: "clinic-1",
      userId: "user-1",
      sessionId: "session-1",
      responseId: "resp-1",
      rating: "helpful",
      feedbackType: "remember_this",
      note: "Please keep answers short and show unused-package opportunities first.",
      createdAt: "2026-06-18T00:00:00.000Z",
      resolvedAgent: "customer_relationship",
      intent: "unused_package_balance",
    },
    {
      id: "fb-2",
      clinicId: "clinic-1",
      userId: "user-1",
      sessionId: "session-1",
      responseId: "resp-2",
      rating: "not_helpful",
      feedbackType: "too_long",
      createdAt: "2026-06-18T01:00:00.000Z",
      resolvedAgent: "finance",
      intent: "sales_summary",
    },
    {
      id: "fb-3",
      clinicId: "clinic-1",
      userId: "user-1",
      sessionId: "session-1",
      responseId: "resp-3",
      rating: "not_helpful",
      feedbackType: "too_long",
      createdAt: "2026-06-18T02:00:00.000Z",
      resolvedAgent: "finance",
      intent: "sales_summary",
    },
  ])

  assert.ok(records.some((record) => record.memoryType === "response_style" && record.status === "active"))
  assert.ok(records.some((record) => record.memoryType === "priority_preference" && record.status === "active"))
  assert.ok(records.some((record) => record.source === "feedback" && record.evidenceCount === 2 && record.status === "active"))
})

test("memory retrieval ranks exact scoped active memories and isolates clinics", () => {
  const now = new Date("2026-06-18T00:00:00.000Z")
  const memories = [
    buildMemoryRecord(
      {
        clinicId: "clinic-1",
        userId: "user-1",
        agentId: "customer_relationship",
        intent: "unused_package_balance",
        memoryType: "priority_preference",
        content: "Owner wants unused-package recovery opportunities shown before lower-priority recommendations.",
        source: "explicit_user",
      },
      now.toISOString(),
    ),
    buildMemoryRecord(
      {
        clinicId: "clinic-2",
        userId: "user-1",
        memoryType: "response_style",
        content: "Other clinic preference.",
        source: "explicit_user",
      },
      now.toISOString(),
    ),
  ].filter(Boolean)

  const ranked = rankMemoriesForRequest({
    memories,
    clinicId: "clinic-1",
    userId: "user-1",
    request: { message: "Show unused package balance customers" },
    plan: { resolvedAgent: "customer_relationship", intent: "unused_package_balance" },
    now,
  })

  assert.equal(ranked.length, 1)
  assert.match(ranked[0].content, /unused-package/)
})

test("session summary has bounded fields and expires after TTL", () => {
  const summary = buildSessionSummaryFromTurn({
    clinicId: "clinic-1",
    userId: "user-1",
    sessionId: "session-1",
    request: {
      clinicId: "clinic-1",
      clinicCode: "ABC",
      message: "Show unused package customers today",
      fromDate: "2026-06-18",
      toDate: "2026-06-18",
      timezone: "Asia/Yangon",
    },
    response: {
      sessionId: "session-1",
      requestId: "request-1",
      responseId: "resp-1",
      requestedAgent: "customer_relationship",
      resolvedAgent: "customer_relationship",
      autoMode: false,
      intent: "unused_package_balance",
      assistantMessage: "Summary",
      summary: "Summary",
      recommendations: [{ recommendationId: "rec-1", message: "Follow up.", sourceTools: [] }],
      followUpQuestions: [],
      sources: [],
      dataStatus: "ok",
      actions: [{ type: "read_only_agent_response" }],
    },
    entityRefs: [{ entityType: "customer", entityId: "c-1", displayName: "Customer", rank: 1 }],
    usedMemories: [],
    now: "2026-06-18T00:00:00.000Z",
  })

  assert.equal(summary.lastRecommendationIds[0], "rec-1")
  assert.equal(summary.activeEntityRefs.length, 1)
  assert.equal(isSessionSummaryFresh(summary, new Date("2026-06-18T12:00:00.000Z").getTime()), true)
  assert.equal(isSessionSummaryFresh(summary, new Date("2026-06-19T01:00:00.000Z").getTime()), false)
})

test("learning bucket calculation respects Asia/Yangon local time and operational intervals", () => {
  const now = new Date("2026-06-22T18:45:00.000Z")

  assert.equal(
    buildLearningBucket({
      jobType: "appointment_operational_snapshot",
      now,
      timezone: "Asia/Yangon",
      operationalIntervalMinutes: 15,
    }),
    "2026-06-23T01:15+Asia/Yangon",
  )
  assert.equal(
    buildLearningBucket({
      jobType: "feedback_learning",
      now,
      timezone: "Asia/Yangon",
    }),
    "2026-06-23T01:00+Asia/Yangon",
  )
  assert.equal(
    buildLearningBucket({
      jobType: "finance_daily_snapshot",
      now,
      timezone: "Asia/Yangon",
    }),
    "2026-06-23+Asia/Yangon",
  )
})

test("schedule due helper skips closed clinics unless off-hours monitoring is enabled", () => {
  const schedule = {
    id: "schedule-1",
    clinicId: "clinic-1",
    clinicCode: "ABC",
    timezone: "Asia/Yangon",
    enabled: true,
    enabledJobTypes: ["appointment_operational_snapshot" as const],
    operatingDays: [2],
    localOpeningTime: "09:00",
    localClosingTime: "18:00",
    operationalSnapshotIntervalMinutes: 15 as const,
    offHoursOperationalSnapshotEnabled: false,
  }
  const afterHours = new Date("2026-06-23T14:00:00.000Z")

  assert.equal(isScheduleDueForJob({ schedule, jobType: "appointment_operational_snapshot", now: afterHours }), false)
  assert.equal(
    isScheduleDueForJob({
      schedule: { ...schedule, offHoursOperationalSnapshotEnabled: true },
      jobType: "appointment_operational_snapshot",
      now: afterHours,
    }),
    true,
  )
})

test("scheduler secret helper rejects missing or incorrect secrets", () => {
  assert.equal(isAgentLearningSchedulerSecretValid("scheduler-secret"), true)
  assert.equal(isAgentLearningSchedulerSecretValid("wrong"), false)
  assert.equal(isAgentLearningSchedulerSecretValid(undefined), false)
})

test("locked Agent Hub response is structured instead of a raw 403 chat failure", () => {
  const response = buildLockedAgentHubResponse({
    request: {
      clinicId: "clinic-1",
      clinicCode: "ABC",
      agent: "appointment",
      message: "How many appointments today?",
    },
    premium: {
      feature: "gt_growth_ai",
      enabled: false,
      title: "Unlock GT Growth AI",
      message: "AI insights and recommended actions are available with GT Growth AI.",
      upgradeMessage: "Upgrade to see AI recommendations.",
      lockedReason: "gt_growth_ai is not enabled for this clinic.",
    },
  })

  assert.equal(response.dataStatus, "not_ready")
  assert.equal(response.intent, "feature_locked")
  assert.equal(response.sources[0]?.tool, "gt_growth_ai_feature_gate")
  assert.match(response.assistantMessage, /Upgrade/)
})
