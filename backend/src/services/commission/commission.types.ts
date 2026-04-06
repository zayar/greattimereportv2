export type CommissionEventType =
  | "sale_based"
  | "payment_based"
  | "treatment_completed_based"

export type CommissionFormulaType =
  | "percentage_of_amount"
  | "fixed_amount_per_item"
  | "fixed_amount_per_completed_treatment"
  | "tiered_percentage"
  | "target_bonus"

export type CommissionBaseField = "grossAmount" | "netAmount" | "collectedAmount"
export type CommissionRuleStatus = "draft" | "active" | "archived"
export type CommissionRunStatus = "running" | "completed" | "failed"
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

export interface PercentageOfAmountConfig {
  baseField: CommissionBaseField
  value: number
}

export interface FixedAmountConfig {
  value: number
}

export interface TieredPercentageConfig {
  baseField: CommissionBaseField
  tiers: CommissionTier[]
}

export interface TargetBonusConfig {
  baseField: CommissionBaseField
  threshold: number
  bonusType: CommissionBonusType
  value: number
}

export type CommissionFormulaConfig =
  | PercentageOfAmountConfig
  | FixedAmountConfig
  | TieredPercentageConfig
  | TargetBonusConfig

export interface CommissionRuleRecord {
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
  createdByUserId: string | null
  createdByEmail: string | null
  updatedByUserId: string | null
  updatedByEmail: string | null
}

export interface CommissionAdjustmentRecord {
  id: string
  merchantId: string
  merchantName: string
  monthKey: string
  staffId: string
  staffName: string
  amount: number
  reason: string
  createdAt: string
  createdByUserId: string | null
  createdByEmail: string | null
}

export interface CommissionRuleSnapshot extends CommissionRuleRecord {
  snapshotAt: string
}

export interface CommissionAdjustmentSnapshot extends CommissionAdjustmentRecord {
  snapshotAt: string
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

export interface CommissionRunRecord {
  id: string
  merchantId: string
  merchantName: string
  branchIds: string[]
  branchCodes: string[]
  dateFrom: string
  dateTo: string
  monthKey: string
  generatedAt: string
  generatedByUserId: string | null
  generatedByEmail: string | null
  status: CommissionRunStatus
  selectedRuleIds: string[]
  ruleSnapshots: CommissionRuleSnapshot[]
  summaryTotals: CommissionRunSummaryTotals
  staffSummaries: CommissionStaffSummary[]
  adjustmentSnapshots: CommissionAdjustmentSnapshot[]
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

export interface CommissionReportResultRecord {
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

export interface CommissionSourceRow {
  eventType: CommissionEventType
  merchantId: string
  merchantName: string
  branchId: string
  branchCode: string
  eventDate: string
  sourceId: string
  sourceRef: string
  customerId: string | null
  customerName: string | null
  staffId: string
  staffName: string
  staffRole: string
  itemType: CommissionItemType | null
  categoryName: string | null
  serviceName: string | null
  grossAmount: number
  discountAmount: number
  netAmount: number
  collectedAmount: number
  availableBaseFields: CommissionBaseField[]
  quantity: number
  completedTreatmentCount: number
  paymentStatus: string | null
  packageUsageCount: number
}

export interface CommissionBigQueryScope {
  merchantId: string
  merchantName: string
  branchIds: string[]
  branchCodes: string[]
  fromDate: string
  toDate: string
}

export interface CommissionRuleWriteInput {
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
}

export interface CommissionGenerateInput extends CommissionBigQueryScope {
  staffIds: string[]
  staffRoles: string[]
  generatedByUserId: string | null
  generatedByEmail: string | null
}

export interface CommissionSourceOptions {
  paymentStatuses: string[]
  itemTypes: CommissionItemType[]
  categories: string[]
  services: Array<{
    name: string
    categoryName: string
  }>
  staff: Array<{
    id: string
    name: string
    role: string
    eventTypes: CommissionEventType[]
  }>
}

export interface CommissionCalculationIssue {
  type: "conflict" | "missing_data" | "skipped"
  rowId: string
  sourceRef: string
  message: string
}

export interface CommissionCalculationOutput {
  results: CommissionReportResultRecord[]
  issues: CommissionCalculationIssue[]
  warnings: string[]
  assumptions: string[]
  summaryTotals: CommissionRunSummaryTotals
  staffSummaries: CommissionStaffSummary[]
  ruleSnapshots: CommissionRuleSnapshot[]
  adjustmentSnapshots: CommissionAdjustmentSnapshot[]
}
