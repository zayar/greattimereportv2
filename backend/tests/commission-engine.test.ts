import assert from "node:assert/strict"
import test from "node:test"
import { calculateCommissionReport } from "../src/services/commission/commission-engine.ts"
import type { CommissionRuleRecord, CommissionSourceRow } from "../src/services/commission/commission.types.ts"
import { validateCommissionRuleWriteInput } from "../src/services/commission/commission.utils.ts"

function buildRule(overrides: Partial<CommissionRuleRecord> = {}): CommissionRuleRecord {
  return {
    id: "rule-1",
    merchantId: "merchant-1",
    merchantName: "Merchant One",
    branchIds: ["clinic-1"],
    branchCodes: ["CLINIC1"],
    ruleName: "Therapic Commission for face",
    description: "",
    status: "active",
    appliesToRole: "practitioner",
    appliesToStaffIds: [],
    eventType: "treatment_completed_based",
    conditions: {
      branchIds: ["clinic-1"],
      branchCodes: ["CLINIC1"],
      categoryNames: [],
      serviceNames: ["Facial", "Laser"],
      itemTypes: ["service"],
      paymentStatuses: [],
    },
    formulaType: "fixed_amount_per_service",
    formulaConfig: {
      serviceAmounts: [
        {
          serviceName: "Facial",
          categoryName: "Facial",
          amount: 3000,
        },
        {
          serviceName: "Laser",
          categoryName: "Laser",
          amount: 8000,
        },
      ],
    },
    priority: 100,
    effectiveFrom: "2026-04-01",
    effectiveTo: null,
    version: 1,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    createdByUserId: null,
    createdByEmail: null,
    updatedByUserId: null,
    updatedByEmail: null,
    ...overrides,
  }
}

function buildSourceRow(overrides: Partial<CommissionSourceRow> = {}): CommissionSourceRow {
  return {
    eventType: "treatment_completed_based",
    merchantId: "merchant-1",
    merchantName: "Merchant One",
    branchId: "clinic-1",
    branchCode: "CLINIC1",
    eventDate: "2026-04-05",
    sourceId: "source-1",
    sourceRef: "CO-1001",
    customerId: "customer-1",
    customerName: "Naw Aye",
    staffId: "practitioner:hmu",
    staffName: "Hsu Myat",
    staffRole: "practitioner",
    itemType: "service",
    categoryName: "Facial",
    serviceName: "Facial",
    grossAmount: 50000,
    discountAmount: 0,
    netAmount: 50000,
    collectedAmount: 50000,
    availableBaseFields: ["grossAmount", "netAmount", "collectedAmount"],
    quantity: 1,
    completedTreatmentCount: 1,
    paymentStatus: null,
    packageUsageCount: 0,
    ...overrides,
  }
}

test("calculates service-specific fixed amounts per matching service row", () => {
  const rule = buildRule()
  const sourceRows = [
    buildSourceRow({
      sourceId: "source-1",
      sourceRef: "CO-1001",
      serviceName: "Facial",
      categoryName: "Facial",
      netAmount: 4500000,
      grossAmount: 4500000,
    }),
    buildSourceRow({
      sourceId: "source-2",
      sourceRef: "CO-1002",
      serviceName: "Laser",
      categoryName: "Laser",
      netAmount: 2400000,
      grossAmount: 2400000,
    }),
    buildSourceRow({
      sourceId: "source-3",
      sourceRef: "CO-1003",
      serviceName: "Body",
      categoryName: "Body",
      netAmount: 1000000,
      grossAmount: 1000000,
    }),
  ]

  const result = calculateCommissionReport({
    sourceRows,
    rules: [rule],
    adjustmentSnapshots: [],
    filters: {
      staffIds: [],
      staffRoles: [],
    },
  })

  assert.equal(result.results.length, 2)
  assert.deepEqual(
    result.results.map((entry) => [entry.breakdown.serviceName, entry.commissionAmount]),
    [
      ["Facial", 3000],
      ["Laser", 8000],
    ],
  )
  assert.equal(result.summaryTotals.totalCommissionAmount, 11000)
  assert.match(result.warnings.join(" "), /1 source rows had no matching commission rule/i)
})

test("service-specific fixed amounts multiply by completed treatment count when a row represents multiple treatments", () => {
  const result = calculateCommissionReport({
    sourceRows: [
      buildSourceRow({
        sourceId: "source-2",
        sourceRef: "CO-1002",
        serviceName: "Laser",
        categoryName: "Laser",
        completedTreatmentCount: 2,
      }),
    ],
    rules: [buildRule()],
    adjustmentSnapshots: [],
    filters: {
      staffIds: [],
      staffRoles: [],
    },
  })

  assert.equal(result.results.length, 1)
  assert.equal(result.results[0]?.commissionAmount, 16000)
  assert.match(result.results[0]?.explanation ?? "", /2 service occurrence/)
})

test("service-specific validation rejects missing amounts and non-service item types", () => {
  const errors = validateCommissionRuleWriteInput({
    merchantId: "merchant-1",
    merchantName: "Merchant One",
    branchIds: ["clinic-1"],
    branchCodes: ["CLINIC1"],
    ruleName: "Broken rule",
    description: "",
    status: "draft",
    appliesToRole: "practitioner",
    appliesToStaffIds: [],
    eventType: "treatment_completed_based",
    conditions: {
      branchIds: ["clinic-1"],
      branchCodes: ["CLINIC1"],
      categoryNames: [],
      serviceNames: ["Facial"],
      itemTypes: ["service", "package"],
      paymentStatuses: [],
    },
    formulaType: "fixed_amount_per_service",
    formulaConfig: {
      serviceAmounts: [],
    },
    priority: 100,
    effectiveFrom: "2026-04-01",
    effectiveTo: null,
  })

  assert.deepEqual(errors, [
    "Fixed amount per service only supports service item type in V1.",
    "Every selected service needs its own fixed amount.",
    "Each selected service amount must be greater than 0 MMK.",
  ])
})

test("existing fixed amount per item rules continue to calculate unchanged", () => {
  const rule = buildRule({
    formulaType: "fixed_amount_per_item",
    formulaConfig: {
      value: 2000,
    },
    eventType: "sale_based",
    appliesToRole: "salesperson",
    conditions: {
      branchIds: ["clinic-1"],
      branchCodes: ["CLINIC1"],
      categoryNames: [],
      serviceNames: [],
      itemTypes: ["service"],
      paymentStatuses: [],
    },
  })

  const result = calculateCommissionReport({
    sourceRows: [
      buildSourceRow({
        eventType: "sale_based",
        staffId: "seller:001",
        staffName: "May",
        staffRole: "salesperson",
        quantity: 3,
        completedTreatmentCount: 0,
      }),
    ],
    rules: [rule],
    adjustmentSnapshots: [],
    filters: {
      staffIds: [],
      staffRoles: [],
    },
  })

  assert.equal(result.results.length, 1)
  assert.equal(result.results[0]?.commissionAmount, 6000)
  assert.match(result.results[0]?.formulaSummary ?? "", /per item/i)
})
