import assert from "node:assert/strict"
import test from "node:test"

process.env.APICORE_GRAPHQL_URL ??= "https://example.com/graphql"
process.env.AGENT_LEARNING_SCHEDULER_SECRET ??= "scheduler-secret"

const { isAgentCsvExportRequested, isExportOnlyFollowUp } = await import("../src/services/agent-hub/export-intent.ts")
const { planAgentRequest } = await import("../src/services/agent-hub/intent-planner.ts")
const {
  buildGreatTimeAgentCsvCaption,
  buildGreatTimeAgentCsvExportFromTables,
} = await import("../src/services/telegram/agent-csv-export.service.ts")
const {
  __test: exportCacheTest,
  getLatestTelegramAgentExportCache,
  getTelegramAgentExportCacheById,
  saveLatestTelegramAgentExportCache,
} = await import("../src/services/telegram/agent-export-cache.ts")
const { buildAgentHubTelegramReplyMarkup } = await import("../src/services/telegram/bot.service.ts")

const period = {
  fromDate: "2026-06-01",
  toDate: "2026-06-26",
  label: "this month",
}

const topCustomersTable = {
  title: "Top Customers",
  columns: [
    { key: "customerName", title: "Customer" },
    { key: "totalSpend", title: "Total Spend" },
  ],
  rows: [
    { customerName: "Aye, Aye", totalSpend: 1000, note: 'VIP "Gold"' },
    { customerName: "=HACK()", totalSpend: 2000, note: "line\nbreak" },
  ],
}

test("Agent CSV export intent detects CSV and Excel language without bare sheet false positives", () => {
  assert.equal(isAgentCsvExportRequested("excel export"), true)
  assert.equal(isAgentCsvExportRequested("csv please"), true)
  assert.equal(isAgentCsvExportRequested("send csv"), true)
  assert.equal(isAgentCsvExportRequested("top customers export csv"), true)
  assert.equal(isAgentCsvExportRequested("balance sheet"), false)
  assert.equal(isAgentCsvExportRequested("cash flow statement"), false)
  assert.equal(isAgentCsvExportRequested("sheet"), false)
})

test("Agent CSV export-only follow-up detects previous-result requests only", () => {
  assert.equal(isExportOnlyFollowUp("Excel export"), true)
  assert.equal(isExportOnlyFollowUp("give me excel"), true)
  assert.equal(isExportOnlyFollowUp("download this"), true)
  assert.equal(isExportOnlyFollowUp("csv please"), true)
  assert.equal(isExportOnlyFollowUp("top customers export csv"), false)
  assert.equal(isExportOnlyFollowUp("payment method breakdown csv"), false)
  assert.equal(isExportOnlyFollowUp("appointment list export"), false)
  assert.equal(isExportOnlyFollowUp("balance sheet export"), false)
  assert.equal(isExportOnlyFollowUp("cash flow statement export"), false)
})

test("GreatTime Agent CSV builder exports only structured table rows safely", () => {
  const exportFile = buildGreatTimeAgentCsvExportFromTables({
    tables: [topCustomersTable],
    resolvedAgent: "customer_relationship",
    intent: "top_customers",
    period,
    originalMessage: "Top customers export excel",
    now: "2026-06-26T03:00:00.000Z",
  })

  assert.equal(exportFile.csv.charCodeAt(0), 0xfeff)
  assert.equal(exportFile.csv.slice(1).startsWith("Customer,Total Spend,note\r\n"), true)
  assert.match(exportFile.csv, /"Aye, Aye",1000,"VIP ""Gold"""\r\n/)
  assert.match(exportFile.csv, /'=HACK\(\),2000,"line\nbreak"\r\n/)
  assert.equal(exportFile.rowCount, 2)
  assert.equal(exportFile.tableTitle, "Top Customers")
  assert.equal(exportFile.fileName, "customer_relationship_top_customers_2026-06-26.csv")
  assert.equal(exportFile.fileName.endsWith(".csv"), true)
  assert.equal(exportFile.fileName.endsWith(".xlsx"), false)

  assert.equal(
    buildGreatTimeAgentCsvCaption({ rowCount: exportFile.rowCount, excelRequested: true }),
    "CSV export ready.\nRows: 2\nExcel requests currently return CSV.",
  )
})

test("Telegram Agent export cache stores only the latest unexpired table result", () => {
  exportCacheTest.clearAll()
  const now = Date.now()
  const identity = {
    clinicId: "clinic-1",
    telegramChatId: "chat-1",
    telegramUserId: "user-1",
  }

  const empty = saveLatestTelegramAgentExportCache({
    ...identity,
    resolvedAgent: "finance",
    intent: "payment_summary",
    originalMessage: "summary",
    period,
    tables: [{ title: "Empty", columns: [], rows: [] }],
    now,
  })
  assert.equal(empty, null)
  assert.equal(exportCacheTest.size(), 0)

  const saved = saveLatestTelegramAgentExportCache({
    ...identity,
    clinicCode: "ABC",
    resolvedAgent: "customer_relationship",
    intent: "top_customers",
    originalMessage: "Top customers",
    period,
    tables: [topCustomersTable],
    now,
  })
  assert.ok(saved)
  assert.equal(saved.tableTitle, "Top Customers")
  assert.equal(exportCacheTest.size(), 1)

  const latest = getLatestTelegramAgentExportCache({
    ...identity,
    now: now + 29 * 60_000,
  })
  assert.equal(latest?.exportId, saved.exportId)

  const byId = getTelegramAgentExportCacheById({
    exportId: saved.exportId,
    now: now + 29 * 60_000,
  })
  assert.equal(byId?.cacheKey, saved.cacheKey)

  assert.equal(
    getLatestTelegramAgentExportCache({
      ...identity,
      now: now + 31 * 60_000,
    }),
    null,
  )
  assert.equal(getTelegramAgentExportCacheById({ exportId: saved.exportId, now: now + 31 * 60_000 }), null)
})

test("Agent planner treats CSV/Excel export wording as read-only unless strong writes are present", () => {
  const baseRequest = {
    clinicId: "clinic-1",
    clinicCode: "ABC",
    agent: "auto" as const,
  }

  assert.notEqual(planAgentRequest({ request: { ...baseRequest, message: "send me top customers csv" } }).intent, "unsupported_write_request")
  assert.notEqual(planAgentRequest({ request: { ...baseRequest, message: "generate excel for top services" } }).intent, "unsupported_write_request")
  assert.notEqual(planAgentRequest({ request: { ...baseRequest, message: "payment method breakdown export" } }).intent, "unsupported_write_request")
  assert.equal(planAgentRequest({ request: { ...baseRequest, message: "cancel appointment export csv" } }).intent, "unsupported_write_request")
  assert.equal(planAgentRequest({ request: { ...baseRequest, message: "update customer and export" } }).intent, "unsupported_write_request")
  assert.equal(planAgentRequest({ request: { ...baseRequest, message: "send sms to this customer" } }).intent, "unsupported_write_request")
})

test("Telegram Agent reply markup prepends Download CSV without breaking suggestions", () => {
  const response = {
    sessionId: "session-1",
    requestId: "request-1",
    responseId: "response-1",
    requestedAgent: "auto",
    resolvedAgent: "customer_relationship",
    autoMode: true,
    intent: "top_customers",
    period,
    assistantMessage: "Top customers.",
    summary: "Top customers.",
    tables: [topCustomersTable],
    followUpQuestions: ["Show customer detail for the first customer."],
    sources: [],
    dataStatus: "ok",
    actions: [{ type: "read_only_agent_response" }],
  } as const

  const markup = buildAgentHubTelegramReplyMarkup(response, { exportCallbackData: "gtcsv:export-1" })
  assert.equal(markup?.inline_keyboard[0]?.[0]?.text, "Download CSV")
  assert.equal(markup?.inline_keyboard[0]?.[0]?.callback_data, "gtcsv:export-1")
  assert.equal(markup?.inline_keyboard.length, 1)

  const noTableMarkup = buildAgentHubTelegramReplyMarkup({
    ...response,
    tables: [],
    followUpQuestions: [],
  })
  assert.equal(noTableMarkup, undefined)
})
