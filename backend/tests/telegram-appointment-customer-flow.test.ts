import assert from "node:assert/strict"
import test from "node:test"

process.env.APICORE_GRAPHQL_URL ??= "https://example.com/graphql"
process.env.AGENT_LEARNING_SCHEDULER_SECRET ??= "scheduler-secret"

const {
  __test: appointmentContextTest,
  appointmentContextItemToCustomerEntityContext,
  getRecentAppointmentContext,
  resolveRecentAppointmentReference,
  saveRecentAppointmentContext,
} = await import("../src/services/telegram/appointment-context.ts")
const {
  buildAgentHubTelegramReplyMarkup,
  buildRecentAppointmentContextItemsFromResponse,
  formatAgentHubTelegramReply,
} = await import("../src/services/telegram/bot.service.ts")
const { formatCustomerPhone } = await import("../src/services/telegram/customer-phone.ts")

const period = {
  fromDate: "2026-06-29",
  toDate: "2026-06-29",
  label: "today",
}

function appointmentResponse() {
  return {
    sessionId: "session-1",
    requestId: "request-1",
    responseId: "response-1",
    requestedAgent: "auto",
    resolvedAgent: "appointment",
    autoMode: true,
    intent: "appointment_list",
    period,
    assistantMessage: "Appointment ledger has 2 appointments.",
    summary: "Appointment ledger has 2 appointments.",
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
          { serviceName: "Facial", appointmentCount: 1, customerCount: 1 },
          { serviceName: "Laser", appointmentCount: 1, customerCount: 1 },
        ],
      },
      {
        title: "Appointments",
        columns: [
          { key: "scheduledFrom", title: "Time" },
          { key: "customerName", title: "Customer" },
          { key: "customerPhoneMasked", title: "Phone" },
          { key: "serviceName", title: "Service" },
          { key: "practitionerName", title: "Practitioner" },
          { key: "rawStatus", title: "Status" },
        ],
        rows: [
          {
            appointmentId: "appt-1",
            scheduledFrom: "2026-06-29T09:00:00.000Z",
            customerName: "Pyone Lae Naing",
            customerPhoneMasked: "09***111",
            serviceName: "Facial",
            practitionerName: "Wai Phoo",
            rawStatus: "BOOKED",
          },
          {
            appointmentId: "appt-2",
            scheduledFrom: "2026-06-29T10:00:00.000Z",
            customerName: "Su Myat Lwin",
            customerPhoneMasked: "09***222",
            serviceName: "Laser",
            practitionerName: "Htet Htet",
            rawStatus: "BOOKED",
          },
        ],
      },
    ],
    entityRefs: [
      {
        entityType: "appointment",
        entityId: "appt-1",
        appointmentId: "appt-1",
        customerKey: "cust-pyone",
        displayName: "Pyone Lae Naing",
        customerName: "Pyone Lae Naing",
        customerPhone: "09111111111",
        customerPhoneMasked: "09***111",
        serviceName: "Facial",
        practitionerName: "Wai Phoo",
        appointmentTime: "2026-06-29T09:00:00.000Z",
        appointmentStatus: "BOOKED",
        rank: 1,
      },
      {
        entityType: "appointment",
        entityId: "appt-2",
        appointmentId: "appt-2",
        customerKey: "cust-su-appt",
        displayName: "Su Myat Lwin",
        customerName: "Su Myat Lwin",
        customerPhone: "09222222222",
        customerPhoneMasked: "09***222",
        serviceName: "Laser",
        practitionerName: "Htet Htet",
        appointmentTime: "2026-06-29T10:00:00.000Z",
        appointmentStatus: "BOOKED",
        rank: 2,
      },
    ],
    followUpQuestions: ["Show checked-out customers today."],
    sources: [],
    dataStatus: "ok",
    actions: [{ type: "read_only_agent_response" }],
  } as const
}

test("appointment reply includes phone, stores context, and adds appointment buttons", () => {
  appointmentContextTest.clear()
  const response = appointmentResponse()
  const viewerContext = { canViewFullCustomerPhone: true }
  const items = buildRecentAppointmentContextItemsFromResponse({
    response,
    viewerContext,
    clinicCode: "ABC",
  })
  const message = formatAgentHubTelegramReply(response, { viewerContext, clinicCode: "ABC" })
  const markup = buildAgentHubTelegramReplyMarkup(response, {
    appointmentContextItems: items,
    exportCallbackData: "gtcsv:export-1",
  })

  assert.match(message, /Appointment 2 ခု/)
  assert.match(message, /Pyone Lae Naing/)
  assert.match(message, /Phone: 09111111111/)
  assert.match(message, /Phone: 09222222222/)
  assert.equal(items.length, 2)
  assert.equal(items[0]?.appointmentId, "appt-1")
  assert.equal(items[0]?.customerId, "cust-pyone")
  assert.equal(items[1]?.appointmentId, "appt-2")
  assert.equal(items[1]?.customerId, "cust-su-appt")

  saveRecentAppointmentContext({
    clinicId: "clinic-1",
    clinicCode: "ABC",
    telegramChatId: "chat-1",
    telegramUserId: "user-1",
    appointments: items,
    now: 1000,
  })
  const stored = getRecentAppointmentContext({
    clinicId: "clinic-1",
    telegramChatId: "chat-1",
    telegramUserId: "user-1",
    now: 1000,
  })
  assert.equal(stored?.appointments[0]?.appointmentId, "appt-1")
  assert.equal(stored?.appointments[0]?.customerId, "cust-pyone")
  assert.equal(markup?.inline_keyboard[0]?.[0]?.text, "1 Details")
  assert.equal(markup?.inline_keyboard[0]?.[0]?.callback_data, "customer_details:cust-pyone")
  assert.equal(markup?.inline_keyboard[0]?.[1]?.text, "1 History")
  assert.equal(markup?.inline_keyboard[1]?.[0]?.text, "2 Details")
  assert.equal(markup?.inline_keyboard[2]?.[0]?.text, "⬇️ Download CSV")
})

test("first customer follow-up resolves from recent appointment context", () => {
  const items = buildRecentAppointmentContextItemsFromResponse({
    response: appointmentResponse(),
    viewerContext: { canViewFullCustomerPhone: true },
    clinicCode: "ABC",
  })
  const context = saveRecentAppointmentContext({
    clinicId: "clinic-1",
    clinicCode: "ABC",
    telegramChatId: "chat-1",
    telegramUserId: "user-1",
    appointments: items,
    now: 2000,
  })
  const resolved = resolveRecentAppointmentReference({
    message: "Tell me about first customer",
    context,
  })

  assert.equal(resolved.status, "resolved")
  assert.equal(resolved.status === "resolved" ? resolved.item.customerId : "", "cust-pyone")
  const entity = resolved.status === "resolved" ? appointmentContextItemToCustomerEntityContext(resolved.item) : null
  assert.equal(entity?.entityType, "customer")
  assert.equal(entity?.customerKey, "cust-pyone")
  assert.equal(entity?.customerPhone, "09111111111")
})

test("mistyped appointment customer name returns friendly suggestion from context", () => {
  const context = saveRecentAppointmentContext({
    clinicId: "clinic-1",
    clinicCode: "ABC",
    telegramChatId: "chat-1",
    telegramUserId: "user-1",
    appointments: buildRecentAppointmentContextItemsFromResponse({
      response: appointmentResponse(),
      viewerContext: { canViewFullCustomerPhone: true },
      clinicCode: "ABC",
    }),
    now: 3000,
  })
  const resolved = resolveRecentAppointmentReference({
    message: "Tell me about Phone Lae Naing",
    context,
  })

  assert.equal(resolved.status, "suggestion")
  assert.equal(resolved.status === "suggestion" ? resolved.query : "", "Phone Lae Naing")
  assert.equal(resolved.status === "suggestion" ? resolved.item.customerName : "", "Pyone Lae Naing")
})

test("duplicate global customer response is friendly and has Open buttons", () => {
  const response = {
    sessionId: "session-1",
    requestId: "request-1",
    responseId: "response-1",
    requestedAgent: "auto",
    resolvedAgent: "customer_relationship",
    autoMode: true,
    intent: "customer_360",
    period,
    assistantMessage: "I found 2 customers named Su Myat Lwin. Please choose one.",
    summary: "I found 2 customers named Su Myat Lwin. Please choose one.",
    tables: [
      {
        title: "Possible customer matches",
        columns: [
          { key: "rank", title: "#" },
          { key: "customerName", title: "Customer" },
          { key: "customerPhoneMasked", title: "Phone" },
          { key: "memberId", title: "Member ID" },
        ],
        rows: [
          { rank: 1, customerKey: "cust-su-1", customerName: "Su Myat Lwin", customerPhoneMasked: "09***111", memberId: "M-1" },
          { rank: 2, customerKey: "cust-su-2", customerName: "Su Myat Lwin", customerPhoneMasked: "09***222", memberId: "M-2" },
        ],
      },
    ],
    entityRefs: [
      {
        entityType: "customer",
        entityId: "cust-su-1",
        customerKey: "cust-su-1",
        displayName: "Su Myat Lwin",
        customerName: "Su Myat Lwin",
        customerPhone: "09111111111",
        customerPhoneMasked: "09***111",
        memberId: "M-1",
        rank: 1,
      },
      {
        entityType: "customer",
        entityId: "cust-su-2",
        customerKey: "cust-su-2",
        displayName: "Su Myat Lwin",
        customerName: "Su Myat Lwin",
        customerPhone: "09222222222",
        customerPhoneMasked: "09***222",
        memberId: "M-2",
        rank: 2,
      },
    ],
    warnings: [{ type: "ambiguous_customer_identity", title: "Please choose a customer", message: "Please choose one." }],
    followUpQuestions: [],
    sources: [],
    dataStatus: "not_ready",
    actions: [{ type: "read_only_agent_response" }],
  } as const

  const message = formatAgentHubTelegramReply(response, { viewerContext: { canViewFullCustomerPhone: true }, clinicCode: "ABC" })
  const markup = buildAgentHubTelegramReplyMarkup(response)

  assert.match(message, /Su Myat Lwin/)
  assert.match(message, /ဘယ်သူကိုကြည့်မလဲ/)
  assert.match(message, /09111111111/)
  assert.match(message, /M-2/)
  assert.doesNotMatch(message, /Customer match is ambiguous|No bounded customer match|agent will not silently choose/)
  assert.equal(markup?.inline_keyboard[0]?.[0]?.text, "Open 1")
  assert.equal(markup?.inline_keyboard[0]?.[0]?.callback_data, "customer_details:cust-su-1")
  assert.equal(markup?.inline_keyboard[1]?.[0]?.text, "Open 2")
})

test("second appointment selection opens exact duplicate-name customer from context", () => {
  const context = saveRecentAppointmentContext({
    clinicId: "clinic-1",
    clinicCode: "ABC",
    telegramChatId: "chat-1",
    telegramUserId: "user-1",
    appointments: [
      {
        displayIndex: 1,
        appointmentId: "appt-a",
        customerId: "cust-su-1",
        customerName: "Su Myat Lwin",
        fullPhone: "09111111111",
        maskedPhone: "09***111",
        memberId: "M-1",
        serviceName: "Facial",
        staffName: "Wai Phoo",
        appointmentTime: "09:00",
        appointmentStatus: "ချိန်းထား",
      },
      {
        displayIndex: 2,
        appointmentId: "appt-b",
        customerId: "cust-su-2",
        customerName: "Su Myat Lwin",
        fullPhone: "09222222222",
        maskedPhone: "09***222",
        memberId: "M-2",
        serviceName: "Laser",
        staffName: "Htet Htet",
        appointmentTime: "10:00",
        appointmentStatus: "ချိန်းထား",
      },
    ],
    now: 4000,
  })
  const resolved = resolveRecentAppointmentReference({ message: "2", context })
  const entity = resolved.status === "resolved" ? appointmentContextItemToCustomerEntityContext(resolved.item) : null

  assert.equal(resolved.status, "resolved")
  assert.equal(entity?.customerKey, "cust-su-2")
  assert.equal(entity?.memberId, "M-2")
  assert.equal(entity?.customerPhone, "09222222222")
})

test("new customer with no previous history shows today's appointment and not not-found", () => {
  const response = {
    sessionId: "session-1",
    requestId: "request-1",
    responseId: "response-1",
    requestedAgent: "auto",
    resolvedAgent: "customer_relationship",
    autoMode: true,
    intent: "customer_360",
    period,
    assistantMessage: "Thandar looks like a new customer.\nNo previous appointments or purchase history found yet.",
    summary: "Thandar looks like a new customer.\nNo previous appointments or purchase history found yet.",
    customer360: {
      identity: {
        customerKey: "cust-new",
        displayName: "Thandar",
        phoneNumber: "09999999999",
        maskedPhone: "09***999",
      },
      value: { totalVisits: 0 },
      latestActivity: {},
      preferences: {},
      visitPattern: {},
      packages: { dataStatus: "no_activity", holdings: [], purchaseCount: 0, totalRemainingSessions: 0 },
      appointments: {
        current: [
          {
            appointmentId: "appt-new",
            serviceName: "Facial",
            staffName: "Wai Phoo",
            appointmentTime: "11:00",
            appointmentStatus: "ချိန်းထား",
            phoneNumber: "09999999999",
            phoneMasked: "09***999",
          },
        ],
        upcoming: [],
        recentCompleted: [],
      },
      payments: { recentInvoices: [] },
      usage: { topServices: [], monthlyServiceUsage: [] },
      dataQuality: [],
      sources: [],
    },
    followUpQuestions: [],
    sources: [],
    dataStatus: "no_activity",
    actions: [{ type: "read_only_agent_response" }],
  } as const

  const message = formatAgentHubTelegramReply(response, { viewerContext: { canViewFullCustomerPhone: true }, clinicCode: "ABC" })

  assert.match(message, /looks like a new customer/)
  assert.match(message, /No previous appointments or purchase history found yet/)
  assert.match(message, /Today’s appointment/)
  assert.match(message, /Service: Facial/)
  assert.match(message, /Phone: 09999999999/)
  assert.doesNotMatch(message, /not found/i)
})

test("phone visibility is consistent for authorized and unauthorized viewers", () => {
  const phone = { fullPhone: "09123456789", maskedPhone: "09***789" }

  assert.equal(formatCustomerPhone(phone, { canViewFullCustomerPhone: true }), "09123456789")
  assert.equal(formatCustomerPhone(phone, { canViewFullCustomerPhone: false }), "09***789")

  const fullMessage = formatAgentHubTelegramReply(appointmentResponse(), {
    viewerContext: { canViewFullCustomerPhone: true },
    clinicCode: "ABC",
  })
  const maskedMessage = formatAgentHubTelegramReply(appointmentResponse(), {
    viewerContext: { canViewFullCustomerPhone: false },
    clinicCode: "ABC",
  })

  assert.match(fullMessage, /09111111111/)
  assert.doesNotMatch(maskedMessage, /09111111111/)
  assert.match(maskedMessage, /09\*\*\*111/)
})
