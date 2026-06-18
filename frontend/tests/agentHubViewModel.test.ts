import assert from "node:assert/strict"
import test from "node:test"
import { agentHubStatusClass, contextFromAgentHubRow } from "../src/features/ai/agent-hub/agentHubViewModel"

test("contextFromAgentHubRow prefers exact appointment context", () => {
  const context = contextFromAgentHubRow({
    appointmentId: "appt-1",
    customerName: "Ma Aye",
    serviceName: "Facial",
    practitionerName: "Dr Hla",
  })

  assert.equal(context?.entityType, "appointment")
  assert.equal(context?.appointmentId, "appt-1")
  assert.equal(context?.customerName, "Ma Aye")
})

test("contextFromAgentHubRow builds customer and invoice context", () => {
  assert.deepEqual(contextFromAgentHubRow({ customerKey: "c-1", customerName: "Ma Aye", memberId: "M-1" }), {
    entityType: "customer",
    entityId: "c-1",
    customerKey: "c-1",
    displayName: "Ma Aye",
    customerName: "Ma Aye",
    memberId: "M-1",
  })

  const invoice = contextFromAgentHubRow({ invoiceNumber: "INV-1001", customerName: "Ko Min" })
  assert.equal(invoice?.entityType, "invoice")
  assert.equal(invoice?.invoiceNumber, "INV-1001")
})

test("agentHubStatusClass highlights warning and danger states", () => {
  assert.match(agentHubStatusClass("ok"), /--ok/)
  assert.match(agentHubStatusClass("not_ready"), /--warn/)
  assert.match(agentHubStatusClass("unavailable"), /--danger/)
  assert.equal(agentHubStatusClass("no_activity"), "agent-hub-chip")
})
