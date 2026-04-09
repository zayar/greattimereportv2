import assert from "node:assert/strict"
import test from "node:test"
import { bankingSummaryCommonWhere } from "../src/services/reports/banking-summary.query.ts"

test("banking summary includes regular CO invoices instead of filtering them out", () => {
  assert.ok(!bankingSummaryCommonWhere.includes("NOT STARTS_WITH(InvoiceNumber, 'CO-')"))
  assert.ok(bankingSummaryCommonWhere.includes("PaymentStatus = 'PAID'"))
  assert.ok(bankingSummaryCommonWhere.includes("LOWER(ClinicCode) = LOWER(@clinicCode)"))
})
