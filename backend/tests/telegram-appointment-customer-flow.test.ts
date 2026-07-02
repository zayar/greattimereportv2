import assert from "node:assert/strict"
import test from "node:test"

process.env.APICORE_GRAPHQL_URL ??= "https://example.com/graphql"
process.env.AGENT_LEARNING_SCHEDULER_SECRET ??= "scheduler-secret"
process.env.SHOW_FULL_CUSTOMER_PHONE ??= "true"
process.env.MAX_APPOINTMENT_BUTTONS_PER_PAGE ??= "8"
process.env.APPOINTMENT_BUTTON_PHONE_SUFFIX_DIGITS ??= "3"
process.env.MASK_PHONE_IN_GROUP_CHAT ??= "true"

const {
  __test: appointmentContextTest,
  appointmentContextItemToCustomerEntityContext,
  getRecentAppointmentContext,
  resolveRecentAppointmentReference,
  saveRecentAppointmentContext,
} = await import("../src/services/telegram/appointment-context.ts")
const {
  __test: botTest,
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

const authorizedViewer = {
  chatType: "private" as const,
  telegramUserId: "user-1",
  target: {
    isAgentChatEnabled: true,
    agentChatAccessMode: "all_members" as const,
    agentChatAllowedUserIds: [],
  },
}

const maskedViewer = {
  ...authorizedViewer,
  canViewFullCustomerPhone: false,
}

type AppointmentFixtureRow = readonly [string, string, string, string, string, string]

const baseAppointments: readonly AppointmentFixtureRow[] = [
  ["18:34", "Thein Oo", "95900000061", "959xxxx061", "Booking deposit", "Dr Zun Ko Lwin"],
  ["18:15", "Ju Ju P", "95900000397", "959xxxx397", "Hair Removal Half Leg", "Hsu Myat"],
  ["18:12", "Akria Htun J", "95900000444", "959xxxx444", "Hair Removal Underarm", "July"],
  ["17:55", "May Thu", "95900000555", "959xxxx555", "Facial", "Wai Phoo"],
  ["17:40", "Ei Ei", "95900000666", "959xxxx666", "Whitening Laser", "Htet Htet"],
  ["17:10", "Nandar", "95900000777", "959xxxx777", "Consultation", "Shwe Yee"],
  ["16:45", "Khin May", "95900000888", "959xxxx888", "Body Contouring", "Zin Mar"],
  ["16:20", "Hnin Wut Yee", "95900000999", "959xxxx999", "Hydra Facial", "July"],
  ["15:50", "Thandar Aung", "95900000123", "959xxxx123", "Laser", "Wai Phoo"],
  ["15:20", "Cherry", "95900000234", "959xxxx234", "Facial", "Hsu Myat"],
  ["14:45", "Su Htet", "95900000345", "959xxxx345", "Hair Removal", "Htet Htet"],
  ["14:10", "Moe Pwint", "95900000456", "959xxxx456", "Booking deposit", "Zin Mar"],
  ["13:30", "Yadanar", "95900000567", "959xxxx567", "Whitening Laser", "July"],
] as const

function appointmentResponse(count = 2, rowsOverride?: readonly AppointmentFixtureRow[]) {
  const appointmentRows = (rowsOverride ?? baseAppointments).slice(0, count)
  return {
    sessionId: "session-1",
    requestId: "request-1",
    responseId: "response-1",
    requestedAgent: "auto",
    resolvedAgent: "appointment",
    autoMode: true,
    intent: "appointment_list",
    period,
    assistantMessage: `Appointment ledger has ${appointmentRows.length} appointments.`,
    summary: `Appointment ledger has ${appointmentRows.length} appointments.`,
    metrics: [
      { label: "Appointments", value: appointmentRows.length },
      { label: "Services", value: appointmentRows.length },
    ],
    tables: [
      {
        title: "Appointment services",
        columns: [
          { key: "serviceName", title: "Service" },
          { key: "appointmentCount", title: "Appointments" },
          { key: "customerCount", title: "Customers" },
        ],
        rows: appointmentRows.map((row) => ({ serviceName: row[4], appointmentCount: 1, customerCount: 1 })),
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
        rows: appointmentRows.map((row, index) => ({
          appointmentId: `appt-${index + 1}`,
          scheduledFrom: row[0],
          customerName: row[1],
          customerPhoneMasked: row[3],
          serviceName: row[4],
          practitionerName: row[5],
          rawStatus: "BOOKED",
        })),
      },
    ],
    entityRefs: appointmentRows.map((row, index) => ({
      entityType: "appointment" as const,
      entityId: `appt-${index + 1}`,
      appointmentId: `appt-${index + 1}`,
      customerKey: `cust-${index + 1}`,
      displayName: row[1],
      customerName: row[1],
      customerPhone: row[2],
      customerPhoneMasked: row[3],
      serviceName: row[4],
      practitionerName: row[5],
      appointmentTime: row[0],
      appointmentStatus: "BOOKED",
      rank: index + 1,
    })),
    followUpQuestions: ["Show checked-out customers today."],
    sources: [],
    dataStatus: "ok",
    actions: [{ type: "read_only_agent_response" }],
  } as const
}

function customer360Response(item: ReturnType<typeof buildRecentAppointmentContextItemsFromResponse>[number], options?: { newCustomer?: boolean; historyIntent?: boolean }) {
  const recentCompleted = options?.newCustomer
    ? []
    : [{ checkInTime: "2026-05-18", serviceName: "Whitening Laser", therapistName: "July", status: "CHECKOUT" }]
  const packageHoldings = options?.newCustomer
    ? []
    : [
        {
          packageId: "pkg-1",
          serviceName: "Whitening Laser",
          totalSessions: 5,
          usedSessions: 2,
          remainingSessions: 3,
          latestUsageDate: "2026-05-18",
          latestTherapist: "July",
          status: "active" as const,
        },
      ]

  return {
    sessionId: "session-1",
    requestId: "request-1",
    responseId: "response-1",
    requestedAgent: "auto",
    resolvedAgent: "customer_relationship",
    autoMode: true,
    intent: options?.historyIntent ? "customer_purchase_history" : "customer_360",
    period,
    assistantMessage: options?.newCustomer
      ? `${item.customerName} looks like a new customer.\nNo previous appointments or purchase history found yet.`
      : `${item.customerName} customer card.`,
    summary: options?.newCustomer
      ? `${item.customerName} looks like a new customer.\nNo previous appointments or purchase history found yet.`
      : `${item.customerName} customer card.`,
    entityContext: appointmentContextItemToCustomerEntityContext(item),
    customer360: {
      identity: {
        customerKey: item.customerId,
        memberId: item.memberId,
        displayName: item.customerName,
        phoneNumber: item.resolutionPhone ?? item.fullPhone,
        maskedPhone: item.maskedPhone,
      },
      value: { totalVisits: options?.newCustomer ? 0 : 3 },
      latestActivity: {},
      preferences: {},
      visitPattern: {},
      packages: {
        dataStatus: options?.newCustomer ? "no_activity" : "ok",
        purchaseCount: packageHoldings.length,
        activeHoldingCount: packageHoldings.length,
        totalRemainingSessions: options?.newCustomer ? 0 : 3,
        holdings: packageHoldings,
      },
      appointments: {
        current: [
          {
            appointmentId: item.appointmentId,
            serviceName: item.serviceName,
            staffName: item.staffName,
            appointmentTime: item.appointmentTime,
            appointmentStatus: item.appointmentStatus,
            phoneNumber: item.resolutionPhone ?? item.fullPhone,
            phoneMasked: item.maskedPhone,
          },
        ],
        upcoming: [],
        recentCompleted,
      },
      payments: { recentInvoices: [], invoiceCount: 0 },
      usage: {
        selectedYear: 2026,
        distinctServices: options?.newCustomer ? 0 : 1,
        topServices: options?.newCustomer ? [] : [{ serviceName: "Whitening Laser", totalUsage: 3 }],
        monthlyServiceUsage: [],
      },
      dataQuality: [],
      sources: [],
    },
    followUpQuestions: ["Show recent completed treatments.", "Show package balance."],
    sources: [],
    dataStatus: options?.newCustomer ? "no_activity" : "ok",
    actions: [{ type: "read_only_agent_response" }],
  } as const
}

test("today appointment list with 13 appointments uses named paginated customer buttons", () => {
  appointmentContextTest.clear()
  botTest.clearAppointmentActionCallbacks()
  const response = appointmentResponse(13)
  const items = buildRecentAppointmentContextItemsFromResponse({
    response,
    viewerContext: authorizedViewer,
    clinicCode: "ABC",
  })
  const message = formatAgentHubTelegramReply(response, { viewerContext: authorizedViewer, clinicCode: "ABC" })
  const markup = buildAgentHubTelegramReplyMarkup(response, {
    appointmentContextItems: items,
    exportCallbackData: "gtcsv:export-1",
    clinicId: "clinic-1",
    telegramChatId: "chat-1",
    telegramUserId: "user-1",
  })
  const buttonTexts = markup?.inline_keyboard.flat().map((button) => button.text) ?? []

  assert.match(message, /appointment booking 13 ခု/)
  assert.match(message, /1\. 13:30 — Yadanar/)
  assert.match(message, /13\. 18:34 — Thein Oo/)
  assert.match(message, /Phone: 95900000061/)
  assert.match(message, /Service: Booking deposit/)
  assert.match(message, /Staff: Dr Zun Ko Lwin/)
  assert.match(message, /Status: ချိန်းထား/)
  assert.match(message, /Showing 1-8 of 13 appointment bookings/)
  assert.equal(items.length, 13)
  assert.equal(items[0]?.appointmentId, "appt-13")
  assert.equal(items[0]?.customerId, "cust-13")
  assert.equal(buttonTexts[0], "13:30 Yadanar")
  assert.equal(buttonTexts[1], "14:10 Moe Pwint")
  assert.equal(buttonTexts[8], "Next")
  assert.equal(buttonTexts.at(-1), "Download CSV")
  assert.doesNotMatch(buttonTexts.join("\n"), /\b\d+\s+Details\b|\b\d+\s+History\b/)

  const firstCallback = markup?.inline_keyboard[0]?.[0]?.callback_data ?? ""
  assert.match(firstCallback, /^apptsel:/)
  const token = botTest.getAppointmentActionToken(firstCallback.replace("apptsel:", ""))
  assert.equal(token?.appointmentId, "appt-13")
  assert.equal(token?.customerId, "cust-13")
})

test("Telegram appointment list displays roster filter metadata and empty filtered results safely", () => {
  const staffMessage = formatAgentHubTelegramReply(
    {
      ...appointmentResponse(2, [
        ["09:00", "Chit Thiri Ko", "95900000061", "959xxxx061", "Booking deposit", "Dr Zun Ko Lwin"],
        ["10:00", "May Thu", "95900000555", "959xxxx555", "Body Contouring", "Dr Zun Ko Lwin"],
      ]),
      data: {
        appointmentFilter: {
          practitionerName: "Dr Zun Ko Lwin",
          sourceRowCount: 4,
        },
      },
    },
    { viewerContext: authorizedViewer, clinicCode: "ABC" },
  )
  const serviceMessage = formatAgentHubTelegramReply(
    {
      ...appointmentResponse(2, [
        ["09:00", "Chit Thiri Ko", "95900000061", "959xxxx061", "Booking deposit", "Dr Zun Ko Lwin"],
        ["11:00", "Nandar", "95900000777", "959xxxx777", "Booking deposit", "Shwe Yee"],
      ]),
      data: {
        appointmentFilter: {
          serviceName: "Booking deposit",
          sourceRowCount: 4,
        },
      },
    },
    { viewerContext: authorizedViewer, clinicCode: "ABC" },
  )
  const combinedMessage = formatAgentHubTelegramReply(
    {
      ...appointmentResponse(1, [
        ["09:00", "Chit Thiri Ko", "95900000061", "959xxxx061", "Booking deposit", "Dr Zun Ko Lwin"],
      ]),
      data: {
        appointmentFilter: {
          practitionerName: "Dr Zun Ko Lwin",
          serviceName: "Booking deposit",
          sourceRowCount: 4,
        },
      },
    },
    { viewerContext: authorizedViewer, clinicCode: "ABC" },
  )
  const emptyMessage = formatAgentHubTelegramReply(
    {
      ...appointmentResponse(0, []),
      dataStatus: "no_activity",
      data: {
        appointmentFilter: {
          practitionerName: "Dr Zun Ko Lwin",
          sourceRowCount: 2,
        },
      },
      warnings: [
        {
          type: "appointment_filter_no_match",
          title: "Appointment filter not found",
          message: "I could not find Dr Zun Ko Lwin in today's appointments. Available staff today: Shwe Yee, Ngwe Yee.",
        },
      ],
    },
    { viewerContext: authorizedViewer, clinicCode: "ABC" },
  )

  assert.match(staffMessage, /Filter: Staff: Dr Zun Ko Lwin/)
  assert.match(serviceMessage, /Filter: Service: Booking deposit/)
  assert.match(combinedMessage, /Filter: Staff: Dr Zun Ko Lwin၊ Service: Booking deposit/)
  assert.match(emptyMessage, /ဒီနေ့ Dr Zun Ko Lwin အတွက် appointment booking မတွေ့ပါ/)
  assert.doesNotMatch(emptyMessage, /\n1\./)
})

test("Telegram appointment list preserves local APICORE times without Yangon double shift", () => {
  const response = appointmentResponse(4, [
    ["2026-06-30T10:25:00.000Z", "Yin Thu Min@ Thinza San E", "95900000293", "959xxxx293", "Hair Removal Underarm", "Mon Mon"],
    ["2026-06-30T11:08:00.000Z", "Poe Myat Hay Thar", "95900000195", "959xxxx195", "Whitening Laser", "Htet Htet"],
    ["2026-06-30T09:59:00.000Z", "May Thu Khine", "95900000543", "959xxxx543", "Booking deposit", "Dr Zun Ko Lwin"],
    ["2026-06-30 09:32 AM", "Nan Eaindray Moe", "95900000998", "959xxxx998", "Hair Removal Underarm", "Zin Mar"],
  ])
  const message = formatAgentHubTelegramReply(response, { viewerContext: authorizedViewer, clinicCode: "ABC" })
  const items = buildRecentAppointmentContextItemsFromResponse({
    response,
    viewerContext: authorizedViewer,
    clinicCode: "ABC",
  })

  assert.match(message, /1\. 09:32 — Nan Eaindray Moe/)
  assert.match(message, /2\. 09:59 — May Thu Khine/)
  assert.match(message, /3\. 10:25 — Yin Thu Min@ Thinza San E/)
  assert.match(message, /4\. 11:08 — Poe Myat Hay Thar/)
  assert.doesNotMatch(message, /16:02|16:29|16:55|17:38|24:/)
  assert.equal(items[0]?.appointmentTime, "09:32")
  assert.equal(items[1]?.appointmentTime, "09:59")
  assert.equal(items[2]?.appointmentTime, "10:25")
  assert.equal(items[3]?.appointmentTime, "11:08")
})

test("customer-name button token resolves exact appointment and customer card actions", () => {
  botTest.clearAppointmentActionCallbacks()
  const items = buildRecentAppointmentContextItemsFromResponse({
    response: appointmentResponse(2),
    viewerContext: authorizedViewer,
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
  const markup = buildAgentHubTelegramReplyMarkup(appointmentResponse(2), {
    appointmentContextItems: items,
    clinicId: "clinic-1",
    telegramChatId: "chat-1",
    telegramUserId: "user-1",
  })
  const callback = markup?.inline_keyboard[0]?.[0]?.callback_data ?? ""
  const token = botTest.getAppointmentActionToken(callback.replace("apptsel:", ""))
  const selected = context?.appointments.find((item) => item.appointmentId === token?.appointmentId)
  const entity = selected ? appointmentContextItemToCustomerEntityContext(selected) : null
  const cardResponse = selected ? customer360Response(selected) : null
  const cardMessage = cardResponse ? formatAgentHubTelegramReply(cardResponse, { viewerContext: authorizedViewer, clinicCode: "ABC" }) : ""
  const cardMarkup = cardResponse
    ? buildAgentHubTelegramReplyMarkup(cardResponse, {
        recentAppointmentContext: context,
        clinicId: "clinic-1",
        telegramChatId: "chat-1",
        telegramUserId: "user-1",
      })
    : undefined
  const cardButtons = cardMarkup?.inline_keyboard.flat().map((button) => button.text) ?? []

  assert.equal(entity?.customerKey, "cust-2")
  assert.equal(entity?.appointmentId, "appt-2")
  assert.equal(entity?.customerName, "Ju Ju P")
  assert.match(cardMessage, /^Ju Ju P/)
  assert.match(cardMessage, /Today appointment: 18:15/)
  assert.match(cardMessage, /Service: Hair Removal Half Leg/)
  assert.match(cardMessage, /Last visit:/)
  assert.match(cardMessage, /Total visits: 3/)
  assert.deepEqual(cardButtons, ["Full History", "Package / Balance", "Back to Today Appointments"])
})

test("history action appears only after customer is selected", () => {
  botTest.clearCustomerActionCallbacks()
  const items = buildRecentAppointmentContextItemsFromResponse({
    response: appointmentResponse(2),
    viewerContext: authorizedViewer,
    clinicCode: "ABC",
  })
  const context = saveRecentAppointmentContext({
    clinicId: "clinic-1",
    clinicCode: "ABC",
    telegramChatId: "chat-1",
    telegramUserId: "user-1",
    appointments: items,
    now: 3000,
  })
  const appointmentMarkup = buildAgentHubTelegramReplyMarkup(appointmentResponse(2), {
    appointmentContextItems: items,
    clinicId: "clinic-1",
    telegramChatId: "chat-1",
    telegramUserId: "user-1",
  })
  const appointmentButtons = appointmentMarkup?.inline_keyboard.flat().map((button) => button.text) ?? []
  const cardResponse = customer360Response(items[0]!)
  const cardMarkup = buildAgentHubTelegramReplyMarkup(cardResponse, {
    recentAppointmentContext: context,
    clinicId: "clinic-1",
    telegramChatId: "chat-1",
    telegramUserId: "user-1",
  })
  const cardButtons = cardMarkup?.inline_keyboard.flat().map((button) => button.text) ?? []

  assert.doesNotMatch(appointmentButtons.join("\n"), /History/)
  assert.match(cardButtons.join("\n"), /Full History/)
  assert.match(cardButtons.join("\n"), /Back to Today Appointments/)
})

test("generic next question buttons are not rendered in Telegram markup", () => {
  const response = {
    sessionId: "session-1",
    requestId: "request-1",
    responseId: "response-1",
    requestedAgent: "auto",
    resolvedAgent: "finance",
    autoMode: true,
    intent: "payment_summary",
    period,
    assistantMessage: "Payment methods.",
    summary: "Payment methods.",
    tables: [],
    followUpQuestions: ["Next Question 1", "Show payment methods by amount.", "ဆက်မေးခွန်း 2", "နောက်မေးခွန်း 3"],
    sources: [],
    dataStatus: "ok",
    actions: [{ type: "read_only_agent_response" }],
  } as const

  const noActionMarkup = buildAgentHubTelegramReplyMarkup(response)
  const csvMarkup = buildAgentHubTelegramReplyMarkup(response, { exportCallbackData: "gtcsv:export-1" })
  const csvButtons = csvMarkup?.inline_keyboard.flat().map((button) => button.text) ?? []

  assert.equal(noActionMarkup, undefined)
  assert.deepEqual(csvButtons, ["Download CSV"])
  assert.doesNotMatch(csvButtons.join("\n"), /Next Question|next question|ဆက်မေးခွန်း|နောက်မေးခွန်း/i)
})

test("duplicate customer names disambiguate appointment buttons and manual search choices stay friendly", () => {
  botTest.clearAppointmentActionCallbacks()
  botTest.clearCustomerActionCallbacks()
  const duplicateRows = [
    ["18:15", "Su Myat Lwin", "95911111902", "959xxxx902", "Facial", "July"],
    ["17:30", "Su Myat Lwin", "95922222210", "959xxxx210", "Laser", "Hsu Myat"],
  ] as const
  const response = appointmentResponse(2, duplicateRows)
  const items = buildRecentAppointmentContextItemsFromResponse({
    response,
    viewerContext: maskedViewer,
    clinicCode: "ABC",
  })
  const markup = buildAgentHubTelegramReplyMarkup(response, {
    appointmentContextItems: items,
    clinicId: "clinic-1",
    telegramChatId: "chat-1",
    telegramUserId: "user-1",
  })
  const buttonTexts = markup?.inline_keyboard.flat().map((button) => button.text) ?? []
  const secondToken = botTest.getAppointmentActionToken((markup?.inline_keyboard[1]?.[0]?.callback_data ?? "").replace("apptsel:", ""))

  assert.equal(buttonTexts[0], "17:30 Su Myat Lwin · 210")
  assert.equal(buttonTexts[1], "18:15 Su Myat Lwin · 902")
  assert.equal(secondToken?.appointmentId, "appt-1")
  assert.equal(secondToken?.customerId, "cust-1")

  const duplicateSearchResponse = {
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
          { rank: 1, customerKey: "cust-su-1", customerName: "Su Myat Lwin", customerPhoneMasked: "959xxxx902", memberId: "OLEE" },
          { rank: 2, customerKey: "cust-su-2", customerName: "Su Myat Lwin", customerPhoneMasked: "959xxxx210", memberId: "KIUW Bn Hsu" },
        ],
      },
    ],
    entityRefs: [
      {
        entityType: "customer" as const,
        entityId: "cust-su-1",
        customerKey: "cust-su-1",
        displayName: "Su Myat Lwin",
        customerName: "Su Myat Lwin",
        customerPhone: "95911111902",
        customerPhoneMasked: "959xxxx902",
        memberId: "OLEE",
        rank: 1,
      },
      {
        entityType: "customer" as const,
        entityId: "cust-su-2",
        customerKey: "cust-su-2",
        displayName: "Su Myat Lwin",
        customerName: "Su Myat Lwin",
        customerPhone: "95922222210",
        customerPhoneMasked: "959xxxx210",
        memberId: "KIUW Bn Hsu",
        rank: 2,
      },
    ],
    warnings: [{ type: "ambiguous_customer_identity", title: "Please choose a customer", message: "Please choose one." }],
    followUpQuestions: [],
    sources: [],
    dataStatus: "not_ready",
    actions: [{ type: "read_only_agent_response" }],
  } as const

  const choiceMessage = formatAgentHubTelegramReply(duplicateSearchResponse, { viewerContext: maskedViewer, clinicCode: "ABC" })
  const choiceMarkup = buildAgentHubTelegramReplyMarkup(duplicateSearchResponse)
  const firstChoiceCallback = choiceMarkup?.inline_keyboard[0]?.[0]?.callback_data ?? ""
  const firstChoice = botTest.getCustomerActionRef(firstChoiceCallback.replace("customer_details:", ""))

  assert.match(choiceMessage, /Su Myat Lwin ဆိုတဲ့ customer 2 ယောက်တွေ့ပါတယ်/)
  assert.match(choiceMessage, /959xxxx902/)
  assert.match(choiceMessage, /KIUW Bn Hsu/)
  assert.doesNotMatch(choiceMessage, /Customer match is ambiguous|No bounded customer match|agent will not silently choose|resolver|bounded|database match|technical error/i)
  assert.equal(choiceMarkup?.inline_keyboard[0]?.[0]?.text, "Open 1")
  assert.match(firstChoiceCallback, /^customer_details:/)
  assert.equal(firstChoice?.entityContext.customerKey, "cust-su-1")
})

test("existing customer with no history is shown as new, not not-found", () => {
  const items = buildRecentAppointmentContextItemsFromResponse({
    response: appointmentResponse(1),
    viewerContext: authorizedViewer,
    clinicCode: "ABC",
  })
  const context = saveRecentAppointmentContext({
    clinicId: "clinic-1",
    clinicCode: "ABC",
    telegramChatId: "chat-1",
    telegramUserId: "user-1",
    appointments: items,
    now: 4000,
  })
  const response = customer360Response(items[0]!, { newCustomer: true })
  const message = formatAgentHubTelegramReply(response, { viewerContext: authorizedViewer, clinicCode: "ABC" })
  const markup = buildAgentHubTelegramReplyMarkup(response, {
    recentAppointmentContext: context,
    clinicId: "clinic-1",
    telegramChatId: "chat-1",
    telegramUserId: "user-1",
  })
  const buttons = markup?.inline_keyboard.flat().map((button) => button.text) ?? []

  assert.match(message, /This customer looks new/)
  assert.match(message, /No previous history found yet/)
  assert.match(message, /Today appointment: 18:34/)
  assert.doesNotMatch(message, /not found/i)
  assert.deepEqual(buttons, ["Back to Today Appointments"])
})

test("phone visibility is consistent and appointment buttons use suffix only for disambiguation", () => {
  const phone = { fullPhone: "09123456789", maskedPhone: "09***789" }
  assert.equal(formatCustomerPhone(phone, authorizedViewer), "09123456789")
  assert.equal(formatCustomerPhone(phone, { ...authorizedViewer, chatType: "group" }), "09***789")
  assert.equal(formatCustomerPhone(phone, { canViewFullCustomerPhone: false }), "09***789")

  const fullMessage = formatAgentHubTelegramReply(appointmentResponse(1), {
    viewerContext: authorizedViewer,
    clinicCode: "ABC",
  })
  const maskedMessage = formatAgentHubTelegramReply(appointmentResponse(1), {
    viewerContext: maskedViewer,
    clinicCode: "ABC",
  })
  const duplicateRows = [
    ["18:15", "Su Myat Lwin", "95911111902", "959xxxx902", "Facial", "July"],
    ["17:30", "Su Myat Lwin", "95922222210", "959xxxx210", "Laser", "Hsu Myat"],
  ] as const
  const duplicateItems = buildRecentAppointmentContextItemsFromResponse({
    response: appointmentResponse(2, duplicateRows),
    viewerContext: authorizedViewer,
    clinicCode: "ABC",
  })
  const duplicateMarkup = buildAgentHubTelegramReplyMarkup(appointmentResponse(2, duplicateRows), {
    appointmentContextItems: duplicateItems,
    clinicId: "clinic-1",
    telegramChatId: "chat-1",
    telegramUserId: "user-1",
  })
  const labels = duplicateMarkup?.inline_keyboard.flat().map((button) => button.text).join("\n") ?? ""

  assert.match(fullMessage, /95900000061/)
  assert.doesNotMatch(maskedMessage, /95900000061/)
  assert.match(maskedMessage, /959xxxx061/)
  assert.match(labels, /Su Myat Lwin · 902/)
  assert.doesNotMatch(labels, /95911111902|95922222210/)
})

test("recent appointment context still resolves typed indexes and fuzzy names first", () => {
  const items = buildRecentAppointmentContextItemsFromResponse({
    response: appointmentResponse(2),
    viewerContext: authorizedViewer,
    clinicCode: "ABC",
  })
  const context = saveRecentAppointmentContext({
    clinicId: "clinic-1",
    clinicCode: "ABC",
    telegramChatId: "chat-1",
    telegramUserId: "user-1",
    appointments: items,
    now: 5000,
  })
  const stored = getRecentAppointmentContext({
    clinicId: "clinic-1",
    telegramChatId: "chat-1",
    telegramUserId: "user-1",
    now: 5000,
  })
  const first = resolveRecentAppointmentReference({ message: "first customer", context })
  const fuzzy = resolveRecentAppointmentReference({ message: "show Thein O", context })

  assert.equal(stored?.appointments[0]?.appointmentId, "appt-2")
  assert.equal(first.status, "resolved")
  assert.equal(first.status === "resolved" ? first.item.customerId : "", "cust-2")
  assert.equal(fuzzy.status, "resolved")
  assert.equal(fuzzy.status === "resolved" ? fuzzy.item.customerName : "", "Thein Oo")
})
