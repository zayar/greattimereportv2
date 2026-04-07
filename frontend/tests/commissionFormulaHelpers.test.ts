import assert from "node:assert/strict"
import test from "node:test"
import {
  applyFixedAmountToAllServices,
  buildDefaultFormulaConfig,
  syncFixedAmountPerServiceConfig,
  validateCommissionRulePayload,
} from "../src/features/commission/commissionFormulaHelpers"
import {
  buildCommissionRuleDraft,
  buildRulePreview,
  formatCommissionFormulaSummary,
  mapRuleToPayload,
} from "../src/features/commission/commissionHelpers"
import type { CommissionBranchOption, CommissionRule } from "../src/features/commission/types"

const branches: CommissionBranchOption[] = [
  {
    id: "clinic-1",
    code: "GTTHEQUEEN",
    name: "The Queen",
  },
]

test("builds an empty fixed-amount-per-service config by default", () => {
  assert.deepEqual(buildDefaultFormulaConfig("fixed_amount_per_service"), {
    serviceAmounts: [],
  })
})

test("syncs service-specific amounts on create and preserves existing values on edit", () => {
  const created = syncFixedAmountPerServiceConfig({
    formulaConfig: {
      serviceAmounts: [],
    },
    selectedServices: [
      { serviceName: "Emface", categoryName: "Facial" },
      { serviceName: "HIFU", categoryName: "Facial" },
    ],
  })

  assert.deepEqual(created.serviceAmounts, [
    { serviceName: "Emface", categoryName: "Facial", amount: 0 },
    { serviceName: "HIFU", categoryName: "Facial", amount: 0 },
  ])

  const edited = syncFixedAmountPerServiceConfig({
    formulaConfig: {
      serviceAmounts: [
        { serviceName: "Emface", categoryName: "Facial", amount: 3000 },
        { serviceName: "HIFU", categoryName: "Facial", amount: 15000 },
      ],
    },
    selectedServices: [
      { serviceName: "HIFU", categoryName: "Facial" },
      { serviceName: "Laser", categoryName: "Laser" },
    ],
  })

  assert.deepEqual(edited.serviceAmounts, [
    { serviceName: "HIFU", categoryName: "Facial", amount: 15000 },
    { serviceName: "Laser", categoryName: "Laser", amount: 0 },
  ])
})

test("can apply the same amount to every selected service", () => {
  const updated = applyFixedAmountToAllServices({
    formulaConfig: {
      serviceAmounts: [],
    },
    selectedServices: [
      { serviceName: "Facial", categoryName: "Facial" },
      { serviceName: "Laser", categoryName: "Laser" },
      { serviceName: "HIFU", categoryName: "Facial" },
    ],
    amount: 8000,
  })

  assert.deepEqual(updated.serviceAmounts.map((entry) => entry.amount), [8000, 8000, 8000])
})

test("validates service-specific rules and preserves saved mappings in edit hydration", () => {
  const draft = buildCommissionRuleDraft({
    merchantId: "merchant-1",
    merchantName: "Lifestyle",
    clinicId: "clinic-1",
    branches,
    defaultBranchId: "clinic-1",
  })

  const invalidRule = {
    ...draft,
    eventType: "treatment_completed_based" as const,
    appliesToRole: "practitioner",
    formulaType: "fixed_amount_per_service" as const,
    formulaConfig: {
      serviceAmounts: [
        {
          serviceName: "Emface",
          categoryName: "Facial",
          amount: 0,
        },
      ],
    },
    conditions: {
      ...draft.conditions,
      serviceNames: ["Emface"],
      itemTypes: ["service", "package"],
    },
  }

  assert.deepEqual(validateCommissionRulePayload(invalidRule), [
    "Fixed amount per service only supports service item type in V1.",
    "Each selected service must have an amount greater than 0 MMK.",
  ])

  const savedRule: CommissionRule = {
    id: "rule-1",
    merchantId: "merchant-1",
    merchantName: "Lifestyle",
    branchIds: ["clinic-1"],
    branchCodes: ["GTTHEQUEEN"],
    ruleName: "Therapic Commission for face",
    description: "",
    status: "active",
    appliesToRole: "practitioner",
    appliesToStaffIds: [],
    eventType: "treatment_completed_based",
    conditions: {
      branchIds: ["clinic-1"],
      branchCodes: ["GTTHEQUEEN"],
      categoryNames: ["Facial"],
      serviceNames: ["Emface", "HIFU"],
      itemTypes: ["service"],
      paymentStatuses: [],
    },
    formulaType: "fixed_amount_per_service",
    formulaConfig: {
      serviceAmounts: [
        { serviceName: "Emface", categoryName: "Facial", amount: 3000 },
        { serviceName: "HIFU", categoryName: "Facial", amount: 15000 },
      ],
    },
    priority: 100,
    effectiveFrom: "2026-04-01",
    effectiveTo: null,
    version: 1,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  }

  const hydrated = mapRuleToPayload(savedRule, "clinic-1", branches)
  assert.deepEqual(hydrated.formulaConfig, savedRule.formulaConfig)
})

test("renders summary and preview for service-specific amounts", () => {
  const summary = formatCommissionFormulaSummary("fixed_amount_per_service", {
    serviceAmounts: [
      { serviceName: "Emface", categoryName: "Facial", amount: 3000 },
      { serviceName: "Laser", categoryName: "Laser", amount: 8000 },
      { serviceName: "HIFU", categoryName: "Facial", amount: 15000 },
    ],
  })

  assert.equal(summary, "3 service-specific amounts configured")

  const preview = buildRulePreview({
    clinicId: "clinic-1",
    merchantId: "merchant-1",
    merchantName: "Lifestyle",
    branchIds: ["clinic-1"],
    branchCodes: ["GTTHEQUEEN"],
    ruleName: "Therapic Commission for face",
    description: "",
    status: "active",
    appliesToRole: "practitioner",
    appliesToStaffIds: [],
    eventType: "treatment_completed_based",
    conditions: {
      branchIds: ["clinic-1"],
      branchCodes: ["GTTHEQUEEN"],
      categoryNames: ["Facial"],
      serviceNames: ["Emface", "HIFU"],
      itemTypes: ["service"],
      paymentStatuses: [],
    },
    formulaType: "fixed_amount_per_service",
    formulaConfig: {
      serviceAmounts: [
        { serviceName: "Emface", categoryName: "Facial", amount: 3000 },
        { serviceName: "HIFU", categoryName: "Facial", amount: 15000 },
      ],
    },
    priority: 100,
    effectiveFrom: "2026-04-01",
    effectiveTo: "",
  })

  assert.equal(
    preview,
    "For completed treatments, practitioner receive the configured fixed amount for each matching selected service.",
  )
})
