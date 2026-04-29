import assert from "node:assert/strict"
import test from "node:test"
import {
  BANKING_DETAILS_HEADERS,
  buildBankingDetailsCsvRows,
  buildBankingDetailRows,
} from "../src/features/analytics/banking-summary/bankingSummaryRows"
import type { BankingSummaryResponse } from "../src/types/domain"

function buildRow(overrides: Partial<BankingSummaryResponse["rows"][number]> = {}): BankingSummaryResponse["rows"][number] {
  return {
    dateLabel: "2026-04-29",
    invoiceNumber: "SO-100001",
    customerName: "Ma Naw Smile Linn",
    memberId: "",
    salePerson: "MDY 64",
    serviceName: "Exilis Ultra 360",
    servicePackageName: null,
    paymentMethod: "CASH",
    paymentStatus: "PAID",
    walletTopUp: null,
    invoiceNetTotal: 76000,
    ...overrides,
  }
}

test("exports payment details CSV with the same headers and placeholders as the table view", () => {
  const rows = buildBankingDetailRows([
    buildRow(),
    buildRow({
      invoiceNumber: "SO-100002",
      memberId: "MDY 64",
      servicePackageName: "Perfect Bikini",
      paymentMethod: "",
      paymentStatus: "",
      walletTopUp: "Topup *Point",
      invoiceNetTotal: 0,
    }),
  ])
  const csvRows = buildBankingDetailsCsvRows(rows, "MMK")

  assert.deepEqual(BANKING_DETAILS_HEADERS, [
    "Date",
    "Invoice Number",
    "Customer Name",
    "Member ID",
    "Sale Person",
    "Service Name",
    "Service Package",
    "Payment Method",
    "Payment Status",
    "Wallet Top Up",
    "Invoice Net Total",
  ])
  assert.equal(csvRows[0]?.[3], "—")
  assert.equal(csvRows[0]?.[6], "—")
  assert.equal(csvRows[0]?.[9], "—")
  assert.equal(csvRows[0]?.[10], "76,000 MMK")
  assert.equal(csvRows[1]?.[3], "MDY 64")
  assert.equal(csvRows[1]?.[6], "Perfect Bikini")
  assert.equal(csvRows[1]?.[7], "—")
  assert.equal(csvRows[1]?.[8], "—")
  assert.equal(csvRows[1]?.[9], "Topup")
  assert.equal(csvRows[1]?.[10], "0 MMK")
})
