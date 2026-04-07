export type CommissionEventType =
  | "sale_based"
  | "payment_based"
  | "treatment_completed_based"

export type CommissionFormulaType =
  | "percentage_of_amount"
  | "fixed_amount_per_item"
  | "fixed_amount_per_completed_treatment"
  | "fixed_amount_per_service"
  | "tiered_percentage"
  | "target_bonus"

export type CommissionBaseField = "grossAmount" | "netAmount" | "collectedAmount"
export type CommissionRuleStatus = "draft" | "active" | "archived"
export type CommissionItemType = "service" | "package" | "product"
export type CommissionBonusType = "percentage" | "fixed"

export interface CommissionRuleConditions {
  branchIds: string[]
  branchCodes: string[]
  categoryNames: string[]
  serviceNames: string[]
  itemTypes: CommissionItemType[]
  paymentStatuses: string[]
}

export interface CommissionTier {
  min: number
  max: number | null
  value: number
}

export interface CommissionServiceAmount {
  serviceName: string
  categoryName: string
  amount: number
}

export type CommissionFormulaConfig =
  | {
      baseField: CommissionBaseField
      value: number
    }
  | {
      value: number
    }
  | {
      serviceAmounts: CommissionServiceAmount[]
    }
  | {
      baseField: CommissionBaseField
      tiers: CommissionTier[]
    }
  | {
      baseField: CommissionBaseField
      threshold: number
      bonusType: CommissionBonusType
      value: number
    }

export interface CommissionRule {
  id: string
  merchantId: string
  merchantName: string
  branchIds: string[]
  branchCodes: string[]
  ruleName: string
  description: string
  status: CommissionRuleStatus
  appliesToRole: string | null
  appliesToStaffIds: string[]
  eventType: CommissionEventType
  conditions: CommissionRuleConditions
  formulaType: CommissionFormulaType
  formulaConfig: CommissionFormulaConfig
  priority: number
  effectiveFrom: string | null
  effectiveTo: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface CommissionSourceOptions {
  paymentStatuses: string[]
  itemTypes: CommissionItemType[]
  categories: string[]
  services: Array<{
    name: string
    categoryName: string
    eventTypes: CommissionEventType[]
  }>
  staff: Array<{
    id: string
    name: string
    role: string
    eventTypes: CommissionEventType[]
  }>
}

export interface CommissionRulePayload {
  clinicId: string
  merchantId: string
  merchantName: string
  branchIds: string[]
  branchCodes: string[]
  ruleName: string
  description: string
  status: CommissionRuleStatus
  appliesToRole: string
  appliesToStaffIds: string[]
  eventType: CommissionEventType
  conditions: CommissionRuleConditions
  formulaType: CommissionFormulaType
  formulaConfig: CommissionFormulaConfig
  priority: number
  effectiveFrom: string
  effectiveTo: string
}

export interface CommissionAdjustment {
  id: string
  clinicId: string
  merchantId: string
  merchantName: string
  monthKey: string
  staffId: string
  staffName: string
  amount: number
  reason: string
  createdAt: string
}

export interface CommissionAdjustmentPayload {
  clinicId: string
  merchantId: string
  merchantName: string
  monthKey: string
  staffId: string
  staffName: string
  amount: number
  reason: string
}

export interface CommissionRunSummaryTotals {
  totalBaseAmount: number
  totalCommissionAmount: number
  totalAdjustmentAmount: number
  finalPayoutAmount: number
  sourceRowCount: number
  matchedRowCount: number
  skippedRowCount: number
  conflictRowCount: number
  missingDataRowCount: number
  bonusRowCount: number
}

export interface CommissionStaffSummary {
  staffId: string
  staffName: string
  staffRole: string
  branchCodes: string[]
  baseAmount: number
  commissionAmount: number
  adjustmentAmount: number
  finalPayoutAmount: number
  transactionCount: number
  completedTreatmentCount: number
  appliedRuleNames: string[]
}

export interface CommissionRun {
  id: string
  merchantId: string
  merchantName: string
  branchIds: string[]
  branchCodes: string[]
  dateFrom: string
  dateTo: string
  monthKey: string
  generatedAt: string
  status: "running" | "completed" | "failed"
  selectedRuleIds: string[]
  summaryTotals: CommissionRunSummaryTotals
  staffSummaries: CommissionStaffSummary[]
  filters: {
    branchIds: string[]
    branchCodes: string[]
    staffIds: string[]
    staffRoles: string[]
  }
  warnings: string[]
  assumptions: string[]
  resultCount: number
  errorMessage: string | null
}

export interface CommissionReportResult {
  id: string
  runId: string
  merchantId: string
  merchantName: string
  branchId: string
  branchCode: string
  staffId: string
  staffName: string
  staffRole: string
  eventId: string
  sourceType: CommissionEventType | "target_bonus"
  sourceDate: string
  ruleId: string
  ruleName: string
  ruleVersion: number
  baseAmount: number
  commissionAmount: number
  formulaSummary: string
  explanation: string
  sourceRef: string
  breakdown: {
    eventType: CommissionEventType | "target_bonus"
    itemType: CommissionItemType | null
    categoryName: string | null
    serviceName: string | null
    grossAmount: number
    discountAmount: number
    netAmount: number
    collectedAmount: number
    quantity: number
    completedTreatmentCount: number
    paymentStatus: string | null
    customerId: string | null
    customerName: string | null
  }
}

export interface CommissionRunDetail {
  run: CommissionRun
  results: CommissionReportResult[]
}

export interface CommissionGeneratePayload {
  clinicId: string
  merchantId: string
  merchantName: string
  branchIds: string[]
  branchCodes: string[]
  fromDate: string
  toDate: string
  staffIds: string[]
  staffRoles: string[]
}

export interface CommissionGenerateResponse {
  run: CommissionRun
  results: CommissionReportResult[]
}

export interface CommissionBranchOption {
  id: string
  code: string
  name: string
}
