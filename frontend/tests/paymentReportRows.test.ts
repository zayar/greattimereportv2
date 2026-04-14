import assert from "node:assert/strict"
import test from "node:test"
import { buildSalesDetailsCsvRows, buildSalesDetailRows, getGroupedInvoiceValue } from "../src/features/analytics/payment-report/paymentReportRows"
import type { PaymentReportResponse } from "../src/types/domain"

function buildRow(overrides: Partial<PaymentReportResponse["rows"][number]> = {}): PaymentReportResponse["rows"][number] {
  return {
    dateLabel: "2026-04-12",
    invoiceNumber: "SO-078176",
    customerName: "Ms Angelia",
    memberId: "",
    salePerson: "May",
    serviceName: "",
    servicePackageName: "Perfect Bikini",
    itemQuantity: 1,
    itemPrice: 1630000,
    itemTotal: 1059500,
    subTotal: 1630000,
    total: 1899500,
    discount: 0,
    netTotal: 1899500,
    orderBalance: 0,
    orderCreditBalance: 0,
    tax: 0,
    invoiceNetTotal: 1899500,
    paymentStatus: null,
    paymentMethod: null,
    paymentType: null,
    paymentAmount: null,
    paymentNote: null,
    walletTopUp: null,
    ...overrides,
  }
}

test("marks only the first row in an invoice group for invoice summary values", () => {
  const rows = buildSalesDetailRows([
    buildRow(),
    buildRow({
      servicePackageName: "Hair Removal Half Legs x 10 times",
      itemPrice: 1200000,
      itemTotal: 840000,
      subTotal: 1200000,
      paymentStatus: "PAID",
      paymentMethod: "VISA",
      paymentType: "VISA",
    }),
    buildRow({
      invoiceNumber: "SO-091608",
      customerName: "Khaing Zin Naing ( E )",
      servicePackageName: "Underarm Hair Removal x 5 times",
      total: 1560000,
      discount: 510000,
      netTotal: 1050000,
      invoiceNetTotal: 1050000,
    }),
  ])

  assert.equal(rows[0]?.showInvoiceValues, true)
  assert.equal(rows[1]?.showInvoiceValues, false)
  assert.equal(rows[2]?.showInvoiceValues, true)
  assert.equal(getGroupedInvoiceValue(rows[1]!, rows[1]!.total), null)
})

test("blanks invoice summary columns in CSV for repeated invoice rows while keeping service-line details", () => {
  const rows = buildSalesDetailRows([
    buildRow(),
    buildRow({
      servicePackageName: "Hair Removal Half Legs x 10 times",
      itemPrice: 1200000,
      itemTotal: 840000,
      subTotal: 1200000,
      paymentStatus: "PAID",
      paymentMethod: "VISA",
      paymentType: "VISA",
    }),
  ])

  const csvRows = buildSalesDetailsCsvRows(rows, "MMK")

  assert.equal(csvRows[0]?.[12], "1,899,500 MMK")
  assert.equal(csvRows[0]?.[13], "0 MMK")
  assert.equal(csvRows[0]?.[18], "1,899,500 MMK")

  assert.equal(csvRows[1]?.[6], "Hair Removal Half Legs x 10 times")
  assert.equal(csvRows[1]?.[9], "1,200,000 MMK")
  assert.equal(csvRows[1]?.[10], "840,000 MMK")
  assert.equal(csvRows[1]?.[12], "")
  assert.equal(csvRows[1]?.[13], "")
  assert.equal(csvRows[1]?.[14], "")
  assert.equal(csvRows[1]?.[15], "")
  assert.equal(csvRows[1]?.[16], "")
  assert.equal(csvRows[1]?.[17], "")
  assert.equal(csvRows[1]?.[18], "")
  assert.equal(csvRows[1]?.[19], "PAID")
  assert.equal(csvRows[1]?.[20], "VISA")
  assert.equal(csvRows[1]?.[21], "VISA")
})
