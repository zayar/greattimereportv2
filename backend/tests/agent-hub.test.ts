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
const { extractLikelyCustomerSearchText } = await import("../src/services/agent-hub/customer-query.ts")
const { extractExplicitServiceSearchText } = await import("../src/services/agent-hub/service-query.ts")
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
  buildAgentHubTelegramReplyMarkup,
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
  assert.equal(resolveAgent({ requestedAgent: "auto", message: "Soe Moe Thu ( C )" }).resolvedAgent, "customer_relationship")
  assert.equal(resolveAgent({ requestedAgent: "auto", message: "Tell me about Whitening Laser" }).resolvedAgent, "business")
})

test("supervisor routes appointment questions with customer or service words to Appointment Agent", () => {
  assert.equal(
    resolveAgent({ requestedAgent: "auto", message: "Who are the customers today's appointment?" }).resolvedAgent,
    "appointment",
  )
  assert.equal(
    resolveAgent({ requestedAgent: "auto", message: "What service are appointments today?" }).resolvedAgent,
    "appointment",
  )
  assert.equal(resolveAgent({ requestedAgent: "auto", message: "appointment sales" }).resolvedAgent, "finance")
})

test("supervisor handles Myanmar keywords and deterministic tie-breaking", () => {
  assert.equal(resolveAgent({ requestedAgent: "auto", message: "ဒီနေ့ ငွေ ဘယ်လောက်ရလဲ" }).resolvedAgent, "finance")
  assert.equal(resolveAgent({ requestedAgent: "auto", message: "ဖောက်သည် package လက်ကျန်" }).resolvedAgent, "customer_relationship")
  assert.equal(resolveAgent({ requestedAgent: "auto", message: "appointment sales" }).resolvedAgent, "finance")
})

test("planner extracts relative periods and blocks write requests", () => {
  const now = new Date("2026-06-18T06:00:00.000Z")
  const defaultPeriod = extractAgentPeriod({
    message: "Which service is declining?",
    timezone: "UTC",
    now,
  })
  assert.equal(defaultPeriod.label, "this month")
  assert.equal(defaultPeriod.fromDate, "2026-06-01")
  assert.equal(defaultPeriod.toDate, "2026-06-18")
  assert.equal(defaultPeriod.previousFromDate, "2026-05-01")
  assert.equal(defaultPeriod.previousToDate, "2026-05-18")

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

  const topCustomerPlan = planAgentRequest({
    request: {
      clinicId: "clinic-1",
      clinicCode: "ABC",
      agent: "customer_relationship",
      message: "who are the top customers",
    },
  })

  assert.equal(topCustomerPlan.intent, "top_customers")
  assert.deepEqual(topCustomerPlan.toolNames, ["search_customer_profiles"])

  const callPlan = planAgentRequest({
    request: {
      clinicId: "clinic-1",
      clinicCode: "ABC",
      agent: "customer_relationship",
      message: "who should we call today",
    },
  })

  assert.equal(callPlan.intent, "follow_up_today")
  assert.deepEqual(callPlan.toolNames, ["search_customer_profiles"])
})

test("planner routes named service questions to one-shot Service 360 with month-to-date default", () => {
  const now = new Date("2026-06-18T06:00:00.000Z")
  const plan = planAgentRequest({
    request: {
      clinicId: "clinic-1",
      clinicCode: "ABC",
      agent: "auto",
      message: "Tell me about Whitening Laser",
      timezone: "UTC",
    },
    now,
  })

  assert.equal(extractExplicitServiceSearchText("Tell me about Whitening Laser"), "Whitening Laser")
  assert.equal(extractExplicitServiceSearchText("Which customers used Whitening Laser most?"), "Whitening Laser")
  assert.equal(extractExplicitServiceSearchText("Which services are bought together with Whitening Laser?"), "Whitening Laser")
  assert.equal(extractExplicitServiceSearchText("Which service is declining?"), "")
  assert.equal(plan.resolvedAgent, "business")
  assert.equal(plan.intent, "service_360")
  assert.deepEqual(plan.toolNames, ["get_service_360"])
  assert.equal(plan.period.label, "this month")
  assert.equal(plan.period.fromDate, "2026-06-01")
  assert.equal(plan.period.toDate, "2026-06-18")

  const genericPlan = planAgentRequest({
    request: {
      clinicId: "clinic-1",
      clinicCode: "ABC",
      agent: "business",
      message: "Which service is declining?",
    },
    now,
  })
  assert.equal(genericPlan.intent, "service_trend")

  const explicitPeriodPlan = planAgentRequest({
    request: {
      clinicId: "clinic-1",
      clinicCode: "ABC",
      agent: "business",
      message: "How is Whitening Laser doing last 30 days?",
      timezone: "UTC",
    },
    now,
  })
  assert.equal(explicitPeriodPlan.intent, "service_360")
  assert.equal(explicitPeriodPlan.period.fromDate, "2026-05-20")
  assert.equal(explicitPeriodPlan.period.toDate, "2026-06-18")
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
  assert.equal(extractLikelyCustomerSearchText("Soe Moe Thu ( C )"), "Soe Moe Thu ( C )")
  assert.equal(extractLikelyCustomerSearchText("Which customers should we follow up today?"), "")
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

  const servicesTodayPlan = planAgentRequest({
    request: {
      clinicId: "clinic-1",
      clinicCode: "ABC",
      agent: "auto",
      message: "What service are appointments today?",
    },
  })
  assert.equal(servicesTodayPlan.resolvedAgent, "appointment")
  assert.equal(servicesTodayPlan.intent, "appointment_list")
  assert.deepEqual(servicesTodayPlan.toolNames, ["get_appointment_ledger"])
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

test("Telegram Agent reply formatter uses Myanmar conversational text and button follow-ups", () => {
  const response = {
    sessionId: "session-1",
    requestId: "request-1",
    responseId: "response-1",
    requestedAgent: "auto",
    resolvedAgent: "finance",
    autoMode: true,
    intent: "payment_summary",
    period: {
      fromDate: "2026-06-01",
      toDate: "2026-06-23",
      label: "this month",
    },
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
  } as const
  const message = formatAgentHubTelegramReply(response)
  const markup = buildAgentHubTelegramReplyMarkup(response)

  assert.match(message, /GT Brain/)
  assert.match(message, /ဖြေဆိုသူ: GT Brain → ငွေကြေး Agent/)
  assert.match(message, /ကာလ: ဒီလ/)
  assert.match(message, /စုဆောင်းငွေ: 10,000 ကျပ်/)
  assert.match(message, /Payment methods ကို ဖတ်ရလွယ်အောင်/)
  assert.doesNotMatch(message, /BigQuery payment report: ok/)
  assert.doesNotMatch(message, /Sources:/)
  assert.doesNotMatch(message, /\/ask Show payment methods by amount/)
  assert.equal(markup?.inline_keyboard.length, 1)
  assert.match(markup?.inline_keyboard[0]?.[0]?.text ?? "", /Payment method/)
  assert.match(markup?.inline_keyboard[0]?.[0]?.callback_data ?? "", /^gtask:/)
})

test("Telegram Customer 360 formatter uses owner-friendly Myanmar package context", () => {
  const message = formatAgentHubTelegramReply({
    sessionId: "session-1",
    requestId: "request-1",
    responseId: "response-1",
    requestedAgent: "auto",
    resolvedAgent: "customer_relationship",
    autoMode: true,
    intent: "customer_360",
    period: {
      fromDate: "2026-06-01",
      toDate: "2026-06-23",
      label: "this month",
    },
    assistantMessage: "Soe Moe Thu အကျဉ်းချုပ်\n- 2026 visit 89 ကြိမ်ရှိပါတယ်။",
    summary: "Soe Moe Thu အကျဉ်းချုပ်\n- 2026 visit 89 ကြိမ်ရှိပါတယ်။",
    customer360: {
      identity: {
        customerKey: "cust-1",
        displayName: "Soe Moe Thu",
      },
      value: {
        totalVisits: 89,
      },
      latestActivity: {},
      preferences: {},
      visitPattern: {},
      packages: {
        dataStatus: "ok",
        activeHoldingCount: 1,
        totalRemainingSessions: 14,
        holdings: [
          {
            packageId: "pkg-1",
            serviceName: "ExoMicro",
            totalSessions: 59,
            usedSessions: 45,
            remainingSessions: 14,
            latestUsageDate: "2026-05-29",
            latestTherapist: "Wai Phoo",
            status: "active",
          },
        ],
      },
      appointments: {
        recentCompleted: [{ checkInTime: "2026-06-22", serviceName: "Body Contouring", therapistName: "Htet Htet" }],
      },
      payments: {
        recentInvoices: [],
      },
      usage: {
        selectedYear: 2026,
        topServices: [{ serviceName: "Body Contouring", totalUsage: 20 }],
        monthlyServiceUsage: [],
      },
      recommendation: {
        title: "Package လက်ကျန်အတွက် follow-up လုပ်ပါ",
        reasonCodes: ["unused_package_balance"],
        evidence: ["Package session 14 ခု ကျန်နေပါတယ်။"],
      },
      dataQuality: [],
      sources: [],
    },
    followUpQuestions: ["Show recent completed treatments."],
    sources: [],
    dataStatus: "ok",
    actions: [{ type: "read_only_agent_response" }],
  })

  assert.match(message, /GT Brain/)
  assert.match(message, /ဖြေဆိုသူ: GT Brain → Customer Relationship Agent/)
  assert.match(message, /Package \/ service လက်ကျန်/)
  assert.match(message, /ExoMicro: ကျန် 14\/59/)
  assert.match(message, /အကြံပြုချက်/)
  assert.doesNotMatch(message, /Sources:/)
  assert.doesNotMatch(message, /\/ask Show recent completed treatments/)
})

test("Telegram formatter explains appointment services and practitioner rows without pipe tables", () => {
  const appointmentResponse = {
    sessionId: "session-1",
    requestId: "request-1",
    responseId: "response-1",
    requestedAgent: "auto",
    resolvedAgent: "appointment",
    autoMode: true,
    intent: "appointment_list",
    period: {
      fromDate: "2026-06-24",
      toDate: "2026-06-24",
      label: "today",
    },
    assistantMessage: "APICORE appointment ledger has 2 appointments for 2026-06-24.",
    summary: "APICORE appointment ledger has 2 appointments for 2026-06-24.",
    metrics: [
      { label: "Appointments", value: 2 },
      { label: "Services", value: 2 },
    ],
    tables: [
      {
        title: "Appointment services",
        columns: [
          { key: "serviceName", title: "Service" },
          { key: "appointmentCount", title: "Appointments" },
          { key: "customerCount", title: "Customers" },
        ],
        rows: [
          { serviceName: "Whitening Laser", appointmentCount: 1, customerCount: 1 },
          { serviceName: "Hair Removal Underarm", appointmentCount: 1, customerCount: 1 },
        ],
      },
      {
        title: "Appointments",
        columns: [
          { key: "scheduledFrom", title: "Time" },
          { key: "customerName", title: "Customer" },
          { key: "serviceName", title: "Service" },
          { key: "practitionerName", title: "Practitioner" },
          { key: "rawStatus", title: "Status" },
        ],
        rows: [
          {
            scheduledFrom: "2026-06-24T09:00:00.000Z",
            customerName: "Ma Aye",
            serviceName: "Whitening Laser",
            practitionerName: "Wai Phoo",
            rawStatus: "BOOKED",
          },
        ],
      },
    ],
    warnings: [{ title: "APICORE note", message: "APICORE booking ledger returned partial rows." }],
    followUpQuestions: [
      "Show all appointments today.",
      "How many appointments are scheduled today?",
      "Show checked-out customers today.",
      "Show cancelled and no-show appointments today.",
    ],
    sources: [],
    dataStatus: "ok",
    actions: [{ type: "read_only_agent_response" }],
  } as const
  const appointmentMessage = formatAgentHubTelegramReply(appointmentResponse)
  const appointmentMarkup = buildAgentHubTelegramReplyMarkup(appointmentResponse)

  assert.match(appointmentMessage, /ဒီနေ့ appointment စာရင်း/)
  assert.match(appointmentMessage, /Whitening Laser — appointment 1 ခု/)
  assert.match(appointmentMessage, /Ma Aye အတွက် Whitening Laser appointment ပါ/)
  assert.match(appointmentMessage, /Wai Phoo က တာဝန်ယူထားပါတယ်/)
  assert.doesNotMatch(appointmentMessage, /APICORE/)
  assert.doesNotMatch(appointmentMessage, /Whitening Laser \|/)
  assert.deepEqual(
    appointmentMarkup?.inline_keyboard.map((row) => row[0]?.text),
    ["ပြီးဆုံးသူ ကြည့်မယ်", "ဖျက်/မလာ ကြည့်မယ်"],
  )

  const practitionerMessage = formatAgentHubTelegramReply({
    sessionId: "session-1",
    requestId: "request-1",
    responseId: "response-1",
    requestedAgent: "auto",
    resolvedAgent: "business",
    autoMode: true,
    intent: "practitioner_performance",
    period: {
      fromDate: "2026-06-01",
      toDate: "2026-06-24",
      label: "this month",
    },
    assistantMessage: "Wai Phoo leads volume with 5 treatments.",
    summary: "Wai Phoo leads volume with 5 treatments.",
    metrics: [],
    tables: [
      {
        title: "Practitioner performance",
        columns: [
          { key: "therapistName", title: "Practitioner" },
          { key: "treatmentsCompleted", title: "Treatments" },
          { key: "customersServed", title: "Customers" },
          { key: "topService", title: "Top service" },
        ],
        rows: [{ therapistName: "Wai Phoo", treatmentsCompleted: 5, customersServed: 3, topService: "Whitening Laser" }],
      },
    ],
    sources: [],
    dataStatus: "ok",
    actions: [{ type: "read_only_agent_response" }],
  })

  assert.match(practitionerMessage, /Wai Phoo က treatment 5 ကြိမ်လုပ်ထားပြီး customer 3 ယောက်/)
  assert.match(practitionerMessage, /အများဆုံးလုပ်ထားတဲ့ service က Whitening Laser ပါ/)
  assert.doesNotMatch(practitionerMessage, /Wai Phoo \| 5 \| 3 \| Whitening Laser/)
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

  const serviceRef = resolveEntityReference({
    message: "Tell me about the first service",
    sessionRefs: [
      { entityType: "service", entityId: "svc-1", displayName: "Whitening Laser", serviceName: "Whitening Laser", rank: 1 },
    ],
  })
  assert.equal(serviceRef?.entityId, "svc-1")
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

test("response builder suggests useful appointment next actions without repeating the same list", () => {
  const response = buildAgentResponse({
    request: {
      clinicId: "clinic-1",
      clinicCode: "ABC",
      agent: "appointment",
      message: "Who are the customers today's appointment?",
    },
    sessionId: "session-1",
    requestId: "request-1",
    plan: {
      requestedAgent: "appointment",
      resolvedAgent: "appointment",
      autoMode: false,
      intent: "appointment_list",
      toolNames: ["get_appointment_ledger"],
      period: { fromDate: "2026-06-24", toDate: "2026-06-24", label: "today" },
    },
    toolResults: [
      {
        toolName: "get_appointment_ledger",
        sourceName: "appointment ledger",
        checkedAt: "2026-06-24T00:00:00.000Z",
        dataStatus: "ok",
        live: true,
        tables: [
          {
            title: "Appointments",
            columns: [{ key: "customerName", title: "Customer" }],
            rows: [{ customerName: "Ma Aye" }],
          },
        ],
      },
    ],
  })

  assert.deepEqual(response.followUpQuestions, [
    "Show checked-in customers now.",
    "Show checked-out customers today.",
    "Show cancelled and no-show appointments today.",
  ])
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
  assert.ok(response.followUpQuestions?.includes("Show unused package services."))
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

test("Customer 360 deterministic summary supports the lean yearly visit snapshot", () => {
  const summary = composeCustomer360Summary({
    identity: {
      customerKey: "cust-1",
      displayName: "Soe Moe Thu",
      joinedDate: "2021-07-03",
    },
    value: {
      totalVisits: 44,
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
      recentWindowVisits: 20,
      previousWindowVisits: 18,
      momentum: "stable",
    },
    packages: {
      dataStatus: "not_ready",
      holdings: [],
    },
    appointments: {
      current: [],
      upcoming: [],
      recentCompleted: [{ checkInTime: "2026-06-22", serviceName: "Body Contouring" }],
    },
    payments: {
      recentInvoices: [],
    },
    usage: {
      selectedYear: 2026,
      topServices: [{ serviceName: "Body Contouring", totalUsage: 20 }],
      monthlyServiceUsage: [],
    },
    dataQuality: [
      {
        code: "lifetime_spend_skipped_for_performance",
        severity: "info",
        message: "Lifetime spend was skipped.",
      },
    ],
    sources: [
      {
        tool: "get_customer_visit_snapshot",
        sourceName: "BigQuery customer visits",
        checkedAt: "2026-06-24T00:00:00.000Z",
        dataStatus: "ok",
        live: false,
        scope: "historical",
      },
    ],
  })

  assert.match(summary, /44 visits in 2026/)
  assert.doesNotMatch(summary, /unknown.*lifetime spend/i)
  assert.doesNotMatch(summary, /APICORE shows/i)
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

test("response builder suppresses customer follow-ups when no customer row is bound", () => {
  const response = buildAgentResponse({
    request: {
      clinicId: "clinic-1",
      clinicCode: "ABC",
      agent: "customer_relationship",
      message: "Which customers should we follow up today?",
    },
    sessionId: "session-1",
    requestId: "request-1",
    plan: {
      requestedAgent: "customer_relationship",
      resolvedAgent: "customer_relationship",
      autoMode: false,
      intent: "follow_up_today",
      toolNames: ["search_customer_profiles"],
      period: { fromDate: "2026-06-18", toDate: "2026-06-18", label: "today" },
    },
    toolResults: [
      {
        toolName: "search_customer_profiles",
        sourceName: "profiles",
        checkedAt: "2026-06-18T00:00:00.000Z",
        dataStatus: "no_activity",
        live: false,
        summary: "No customer matches were found for this question.",
        metrics: [{ label: "Matched customers", value: 0 }],
        tables: [
          {
            title: "Customer relationship matches",
            columns: [{ key: "customerName", title: "Customer" }],
            rows: [],
          },
        ],
      },
    ],
  })

  assert.deepEqual(response.followUpQuestions, [])
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
    sourceSessionIds: ["session-1"],
  })
  assert.equal(repeated?.status, "candidate")

  const repeatedReady = buildMemoryRecord({
    clinicId: "clinic-1",
    userId: "user-1",
    memoryType: "response_style",
    content: "Owner often marks responses too long; prefer concise answers for this area.",
    source: "feedback",
    evidenceCount: 3,
    sourceSessionIds: ["session-1", "session-2"],
  })
  assert.equal(repeatedReady?.status, "active")
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
      sessionId: "session-2",
      responseId: "resp-3",
      rating: "not_helpful",
      feedbackType: "too_long",
      createdAt: "2026-06-18T02:00:00.000Z",
      resolvedAgent: "finance",
      intent: "sales_summary",
    },
    {
      id: "fb-4",
      clinicId: "clinic-1",
      userId: "user-1",
      sessionId: "session-2",
      responseId: "resp-4",
      rating: "not_helpful",
      feedbackType: "too_long",
      createdAt: "2026-06-18T03:00:00.000Z",
      resolvedAgent: "finance",
      intent: "sales_summary",
    },
  ])

  assert.ok(
    records.some(
      (record) =>
        record.memoryType === "response_style" &&
        record.preferenceKey === "response.detail_level" &&
        record.preferenceValue === "concise" &&
        record.status === "active",
    ),
  )
  assert.ok(records.some((record) => record.memoryType === "priority_preference" && record.preferenceKey === "recommendation.priority" && record.status === "active"))
  assert.ok(records.some((record) => record.source === "feedback" && record.evidenceCount === 3 && record.status === "active"))
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
      period: {
        fromDate: "2026-06-18",
        toDate: "2026-06-18",
        label: "today",
      },
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
  assert.equal(
    buildLearningBucket({
      jobType: "feedback_learning",
      now: new Date("2026-06-24T04:30:00.000Z"),
      dateKey: "2026-06-10",
      timezone: "Asia/Yangon",
    }),
    "2026-06-10T11:00+Asia/Yangon",
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

test("schedule due helper applies hourly, daily, weekly, and override cadence windows", () => {
  const schedule = {
    id: "schedule-1",
    clinicId: "clinic-1",
    clinicCode: "ABC",
    timezone: "Asia/Yangon",
    enabled: true,
    enabledJobTypes: [
      "feedback_learning" as const,
      "finance_daily_snapshot" as const,
      "weekly_business_review" as const,
      "owner_insight_cards" as const,
    ],
    cadenceOverrides: {
      owner_insight_cards: "daily@09:30",
    },
  }

  assert.equal(
    isScheduleDueForJob({ schedule, jobType: "feedback_learning", now: new Date("2026-06-22T18:30:00.000Z") }),
    true,
  )
  assert.equal(
    isScheduleDueForJob({ schedule, jobType: "feedback_learning", now: new Date("2026-06-22T18:45:00.000Z") }),
    false,
  )
  assert.equal(
    isScheduleDueForJob({ schedule, jobType: "finance_daily_snapshot", now: new Date("2026-06-22T18:45:00.000Z") }),
    true,
  )
  assert.equal(
    isScheduleDueForJob({ schedule, jobType: "weekly_business_review", now: new Date("2026-06-22T01:30:00.000Z") }),
    true,
  )
  assert.equal(
    isScheduleDueForJob({ schedule, jobType: "weekly_business_review", now: new Date("2026-06-23T01:30:00.000Z") }),
    false,
  )
  assert.equal(
    isScheduleDueForJob({ schedule, jobType: "owner_insight_cards", now: new Date("2026-06-23T03:00:00.000Z") }),
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
