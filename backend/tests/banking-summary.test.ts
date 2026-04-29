import assert from "node:assert/strict"
import test from "node:test"
import { buildBankingSummaryFromPaymentReportRows } from "../src/services/reports/banking-summary.transform.ts"
import type { ApicorePaymentReportRow } from "../src/services/apicore.service.ts"

function buildRow(overrides: Partial<ApicorePaymentReportRow> = {}): ApicorePaymentReportRow {
  return {
    Date: "2026-04-28",
    InvoiceNumber: "SO-100001",
    CustomerName: "Ma Naw Smile Linn",
    MemberId: "MDY 64",
    SalePerson: "MDY 64",
    ServiceName: "Exilis Ultra 360",
    ServicePackageName: null,
    PaymentMethod: "UABPAY",
    PaymentStatus: "PAID",
    WalletTopUp: null,
    InvoiceNetTotal: 90000,
    ...overrides,
  }
}

test("banking summary matches legacy payment report by excluding zero no-method rows from totals", () => {
  const result = buildBankingSummaryFromPaymentReportRows(
    [
      buildRow({ PaymentMethod: null, InvoiceNumber: "CO-8796381", InvoiceNetTotal: 0 }),
      buildRow({ PaymentMethod: "UABPAY", InvoiceNetTotal: 2980000 }),
      buildRow({ PaymentMethod: "CASH", InvoiceNumber: "SO-200001", InvoiceNetTotal: 438000 }),
    ],
    {
      search: "",
      paymentMethod: "",
      walletTopupFilter: "all",
      limit: 50,
      offset: 0,
    },
  )

  assert.equal(result.summary.totalRevenue, 3418000)
  assert.equal(result.summary.transactionCount, 2)
  assert.equal(result.summary.methodsCount, 2)
  assert.deepEqual(
    result.methods.map((row) => [row.paymentMethod, row.transactionCount, row.totalAmount]),
    [
      ["UABPAY", 1, 2980000],
      ["CASH", 1, 438000],
    ],
  )
  assert.equal(result.totalCount, 3)
  assert.equal(result.rows[0]?.invoiceNumber, "CO-8796381")
})

test("banking summary applies payment method to detail and stat totals while keeping method options", () => {
  const result = buildBankingSummaryFromPaymentReportRows(
    [
      buildRow({ PaymentMethod: "UABPAY", InvoiceNetTotal: 90000 }),
      buildRow({ PaymentMethod: "CASH", InvoiceNumber: "SO-200001", InvoiceNetTotal: 76000 }),
    ],
    {
      search: "",
      paymentMethod: "CASH",
      walletTopupFilter: "all",
      limit: 50,
      offset: 0,
    },
  )

  assert.equal(result.summary.totalRevenue, 76000)
  assert.equal(result.summary.transactionCount, 1)
  assert.deepEqual(
    result.methods.map((row) => row.paymentMethod),
    ["UABPAY", "CASH"],
  )
  assert.equal(result.totalCount, 1)
  assert.equal(result.rows[0]?.paymentMethod, "CASH")
})

test("banking summary supports the V2 wallet topup filters on legacy rows", () => {
  const result = buildBankingSummaryFromPaymentReportRows(
    [
      buildRow({ InvoiceNumber: "TO-0001", PaymentMethod: "CASH", InvoiceNetTotal: 50000 }),
      buildRow({ InvoiceNumber: "SO-0001", PaymentMethod: "UABPAY", InvoiceNetTotal: 90000 }),
    ],
    {
      search: "",
      paymentMethod: "",
      walletTopupFilter: "hide",
      limit: 50,
      offset: 0,
    },
  )

  assert.equal(result.summary.totalRevenue, 90000)
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0]?.invoiceNumber, "SO-0001")
})
