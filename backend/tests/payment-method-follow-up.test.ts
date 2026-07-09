import assert from "node:assert/strict"
import test from "node:test"

process.env.APICORE_GRAPHQL_URL ??= "https://example.com/graphql"
process.env.AGENT_LEARNING_SCHEDULER_SECRET ??= "scheduler-secret"

const {
  extractPaymentMethodFilter,
  isPaymentMethodDetailQuestion,
  matchPaymentMethodFromAvailableMethods,
} = await import("../src/services/agent-hub/payment-method-intent.ts")
const { createFinanceTools } = await import("../src/services/agent-hub/tools/finance.tools.ts")
const {
  buildRecentPaymentMethodContextItemsFromResponse,
  formatAgentHubTelegramReply,
} = await import("../src/services/telegram/bot.service.ts")
const {
  __test: paymentMethodContextTest,
  resolveRecentPaymentMethodReference,
  saveRecentPaymentMethodContext,
} = await import("../src/services/telegram/payment-method-context.ts")

function buildPaymentReportFixture(overrides?: Partial<{
  totalAmount: number
  invoiceCount: number
  methods: Array<{ paymentMethod: string; totalAmount: number; transactionCount: number }>
  rows: Array<Record<string, unknown>>
}>) {
  const totalAmount = overrides?.totalAmount ?? 0
  const invoiceCount = overrides?.invoiceCount ?? 0

  return {
    summary: {
      totalAmount,
      invoiceCount,
      methodsCount: overrides?.methods?.length ?? 0,
      averageInvoice: invoiceCount ? totalAmount / invoiceCount : 0,
    },
    methods: overrides?.methods ?? [],
    rows: overrides?.rows ?? [],
    totalCount: overrides?.rows?.length ?? invoiceCount,
  }
}

function requireTool(tools: ReturnType<typeof createFinanceTools>, name: string) {
  const tool = tools.find((item) => item.name === name)
  assert.ok(tool, `Expected tool ${name}`)
  return tool
}

function buildToolInput(message: string) {
  return {
    request: {
      clinicId: "clinic-1",
      clinicCode: "ABC",
      agent: "auto" as const,
      message,
      timezone: "UTC",
    },
    clinic: {
      clinicId: "clinic-1",
      clinicCode: "ABC",
    },
    period: {
      fromDate: "2026-07-08",
      toDate: "2026-07-08",
      label: "yesterday",
    },
    intent: "payment_method_detail",
    requestContext: {
      userId: "test-user",
    },
  }
}

test("specific payment method aliases beat generic bank", () => {
  assert.equal(extractPaymentMethodFilter("Yoma bank details"), "YOMA")
  assert.equal(extractPaymentMethodFilter("YOMA details"), "YOMA")
  assert.equal(extractPaymentMethodFilter("Yoma transaction details"), "YOMA")
  assert.equal(extractPaymentMethodFilter("မနေ့က Yoma bank details ပြပေးပါ"), "YOMA")
  assert.equal(extractPaymentMethodFilter("bank details"), "BANK")
  assert.equal(extractPaymentMethodFilter("KPAY details"), "KPAY")
  assert.equal(extractPaymentMethodFilter("KBZ Pay details"), "KPAY")
  assert.equal(extractPaymentMethodFilter("Wavepay transaction details"), "WAVEPAY")
  assert.equal(extractPaymentMethodFilter("Cash details"), "CASH")
  assert.equal(extractPaymentMethodFilter("MMQR details"), "MMQR")
  assert.equal(extractPaymentMethodFilter("QR transaction details"), "MMQR")
  assert.equal(extractPaymentMethodFilter("show QR code setup"), null)
  assert.equal(isPaymentMethodDetailQuestion("Yoma bank details"), true)
})

test("available payment method matching resolves report values before generic bank", () => {
  const methods = ["YOMA", "KPAY", "WAVEPAY", "CASH"]

  assert.equal(matchPaymentMethodFromAvailableMethods("yoma bank details", methods), "YOMA")
  assert.equal(matchPaymentMethodFromAvailableMethods("wavepay details", methods), "WAVEPAY")
  assert.equal(matchPaymentMethodFromAvailableMethods("bank details", methods), null)
})

test("finance payment method detail loads breakdown before selecting YOMA", async () => {
  const requestedPaymentMethods: string[] = []
  const detailTool = requireTool(
    createFinanceTools({
      getCompletedDayFinanceSnapshot: async () => null,
      getSalesReport: async () => ({}) as never,
      getPaymentReport: async (params) => {
        requestedPaymentMethods.push(params.paymentMethod)
        if (!params.paymentMethod) {
          return buildPaymentReportFixture({
            totalAmount: 6_760_000,
            invoiceCount: 4,
            methods: [
              { paymentMethod: "YOMA", totalAmount: 6_000_000, transactionCount: 1 },
              { paymentMethod: "KPAY", totalAmount: 550_000, transactionCount: 2 },
              { paymentMethod: "WAVEPAY", totalAmount: 200_000, transactionCount: 1 },
              { paymentMethod: "CASH", totalAmount: 10_000, transactionCount: 1 },
            ],
          })
        }

        assert.equal(params.paymentMethod, "YOMA")
        return buildPaymentReportFixture({
          totalAmount: 6_000_000,
          invoiceCount: 1,
          methods: [{ paymentMethod: "YOMA", totalAmount: 6_000_000, transactionCount: 1 }],
          rows: [
            {
              dateLabel: "2026-07-08",
              invoiceNumber: "INV-YOMA-001",
              customerName: "Hnin Hnin",
              memberId: "M-YOMA",
              salePerson: "Owner",
              serviceName: "Premium Package",
              servicePackageName: "Yoma Plan",
              paymentMethod: "YOMA",
              paymentStatus: "PAID",
              paymentType: "Bank",
              paymentAmount: 6_000_000,
              paymentNote: "Yoma bank transfer",
              invoiceNetTotal: 6_000_000,
            },
          ],
        })
      },
    }),
    "get_payment_method_detail",
  )

  const result = await detailTool.execute(buildToolInput("မနေ့က Yoma bank details ပြပေးပါ"))

  assert.deepEqual(requestedPaymentMethods, ["", "YOMA"])
  assert.equal(result.data?.paymentMethod, "YOMA")
  assert.equal(result.metrics?.find((metric) => metric.label === "YOMA collected")?.value, 6_000_000)
  assert.equal(result.tables?.[0]?.rows[0]?.invoiceNumber, "INV-YOMA-001")
})

test("finance payment method detail warns when summary has amount but rows are empty", async () => {
  const detailTool = requireTool(
    createFinanceTools({
      getCompletedDayFinanceSnapshot: async () => null,
      getSalesReport: async () => ({}) as never,
      getPaymentReport: async (params) => {
        if (!params.paymentMethod) {
          return buildPaymentReportFixture({
            totalAmount: 6_000_000,
            invoiceCount: 1,
            methods: [{ paymentMethod: "YOMA", totalAmount: 6_000_000, transactionCount: 1 }],
          })
        }

        return buildPaymentReportFixture({
          totalAmount: 0,
          invoiceCount: 0,
          methods: [{ paymentMethod: "YOMA", totalAmount: 6_000_000, transactionCount: 1 }],
          rows: [],
        })
      },
    }),
    "get_payment_method_detail",
  )

  const result = await detailTool.execute(buildToolInput("YOMA details"))

  assert.equal(result.dataStatus, "partial")
  assert.equal(result.tables, undefined)
  assert.match(result.summary ?? "", /Detail query\/filter mismatch/i)
  assert.match(result.warnings?.map((warning) => warning.type).join(","), /payment_method_detail_mismatch/)
})

test("Telegram payment method detail and follow-up context stay mobile friendly", () => {
  paymentMethodContextTest.clear()
  const breakdownResponse = {
    sessionId: "session-1",
    requestId: "request-1",
    responseId: "response-1",
    requestedAgent: "auto",
    resolvedAgent: "finance",
    autoMode: true,
    intent: "payment_method_breakdown",
    period: {
      fromDate: "2026-07-08",
      toDate: "2026-07-08",
      label: "yesterday",
    },
    assistantMessage: "Payment methods.",
    summary: "Payment methods.",
    tables: [
      {
        title: "Payment methods",
        columns: [
          { key: "paymentMethod", title: "Method" },
          { key: "totalAmount", title: "Amount" },
          { key: "transactionCount", title: "Transactions" },
        ],
        rows: [
          { paymentMethod: "YOMA", totalAmount: 6_000_000, transactionCount: 1 },
          { paymentMethod: "KPAY", totalAmount: 550_000, transactionCount: 2 },
        ],
      },
    ],
    sources: [],
    dataStatus: "ok",
    actions: [{ type: "read_only_agent_response" }],
  } satisfies Parameters<typeof buildRecentPaymentMethodContextItemsFromResponse>[0]
  const methods = buildRecentPaymentMethodContextItemsFromResponse(breakdownResponse)
  const context = saveRecentPaymentMethodContext({
    clinicId: "clinic-1",
    clinicCode: "ABC",
    telegramChatId: "chat-1",
    telegramUserId: "user-1",
    period: breakdownResponse.period,
    methods,
    now: 1_000,
  })

  assert.equal(resolveRecentPaymentMethodReference({ message: "Yoma bank details", context }).status, "resolved")
  const second = resolveRecentPaymentMethodReference({ message: "second one", context })
  assert.equal(second.status === "resolved" ? second.item.paymentMethod : "", "KPAY")

  const detailMessage = formatAgentHubTelegramReply({
    sessionId: "session-1",
    requestId: "request-2",
    responseId: "response-2",
    requestedAgent: "auto",
    resolvedAgent: "finance",
    autoMode: true,
    intent: "payment_method_detail",
    period: breakdownResponse.period,
    assistantMessage: "YOMA detail.",
    summary: "YOMA detail.",
    metrics: [
      { label: "YOMA collected", value: 6_000_000, unit: "amount" },
      { label: "Transactions", value: 1 },
    ],
    data: { paymentMethod: "YOMA" },
    sources: [],
    dataStatus: "partial",
    warnings: [
      {
        type: "payment_method_detail_mismatch",
        title: "Payment detail mismatch",
        message: "YOMA has summary amount but no detail rows.",
      },
    ],
    actions: [{ type: "read_only_agent_response" }],
  })

  assert.match(detailMessage, /Payment method: YOMA/)
  assert.match(detailMessage, /YOMA total: 6,000,000 ကျပ်/)
  assert.match(detailMessage, /YOMA အတွက် payment rows မတွေ့ပါ/)
  assert.match(detailMessage, /Detail query\/filter mismatch/)
  assert.doesNotMatch(detailMessage, /BANK collected: 0/)
})
