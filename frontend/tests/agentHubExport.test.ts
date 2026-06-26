import assert from "node:assert/strict"
import test from "node:test"

import {
  buildAgentHubCsvExport,
  isAgentHubCsvExportRequested,
  isAgentHubExportOnlyFollowUp,
} from "../src/features/ai/agent-hub/agentHubExport"
import type { GreatTimeAgentChatResponse } from "../src/types/domain"

const response = {
  sessionId: "session-1",
  requestId: "request-1",
  responseId: "response-1",
  requestedAgent: "auto",
  resolvedAgent: "appointment",
  autoMode: true,
  intent: "appointment_list",
  period: {
    fromDate: "2026-06-26",
    toDate: "2026-06-26",
    label: "today",
  },
  assistantMessage: "Today's appointments.",
  tables: [
    {
      title: "Today's appointment rows",
      columns: [
        { key: "customerName", title: "Customer" },
        { key: "serviceName", title: "Service" },
      ],
      rows: [
        { customerName: "Aye, Aye", serviceName: "Hair Removal", note: "=formula" },
        { customerName: "Ko \"Min\"", serviceName: "Queen Package", note: "line\nbreak" },
      ],
    },
  ],
  sources: [],
  dataStatus: "ok",
  actions: [{ type: "read_only_agent_response" }],
} satisfies GreatTimeAgentChatResponse

test("Agent Hub export intent treats export to excel as previous-table export only", () => {
  assert.equal(isAgentHubCsvExportRequested("export to excel"), true)
  assert.equal(isAgentHubExportOnlyFollowUp("export to excel"), true)
  assert.equal(isAgentHubExportOnlyFollowUp("download this"), true)
  assert.equal(isAgentHubExportOnlyFollowUp("csv please"), true)
  assert.equal(isAgentHubExportOnlyFollowUp("appointment list export"), false)
  assert.equal(isAgentHubExportOnlyFollowUp("balance sheet export"), false)
})

test("Agent Hub CSV export uses structured response tables", () => {
  const exportFile = buildAgentHubCsvExport({
    response,
    originalMessage: "export to excel",
    now: "2026-06-26T15:00:00.000Z",
  })

  assert.ok(exportFile)
  assert.equal(exportFile.fileName, "appointment_today_s_appointment_rows_2026-06-26.csv")
  assert.equal(exportFile.csv.charCodeAt(0), 0xfeff)
  assert.equal(exportFile.csv.slice(1).startsWith("Customer,Service,note\r\n"), true)
  assert.match(exportFile.csv, /"Aye, Aye",Hair Removal,'=formula\r\n/)
  assert.match(exportFile.csv, /"Ko ""Min""",Queen Package,"line\nbreak"\r\n/)
})
