import type {
  CommissionBaseField,
  CommissionBranchOption,
  CommissionEventType,
  CommissionFormulaConfig,
  CommissionFormulaType,
  CommissionRule,
  CommissionRulePayload,
  CommissionSourceOptions,
  CommissionTier,
} from "./types"

export function startOfMonth(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  return `${year}-${month}-01`
}

export function endOfMonth(monthInput: string) {
  const [yearText, monthText] = monthInput.split("-")
  const year = Number(yearText)
  const month = Number(monthText)
  const date = new Date(year, month, 0)
  return date.toISOString().slice(0, 10)
}

export function monthInputFromDate(dateValue: string) {
  return dateValue.slice(0, 7)
}

export function formatCommissionFormulaSummary(formulaType: CommissionFormulaType, formulaConfig: CommissionFormulaConfig) {
  if (formulaType === "percentage_of_amount") {
    const config = formulaConfig as { baseField: CommissionBaseField; value: number }
    return `${config.value}% of ${config.baseField}`
  }

  if (formulaType === "fixed_amount_per_item") {
    const config = formulaConfig as { value: number }
    return `${config.value.toLocaleString("en-US")} per item`
  }

  if (formulaType === "fixed_amount_per_completed_treatment") {
    const config = formulaConfig as { value: number }
    return `${config.value.toLocaleString("en-US")} per completed treatment`
  }

  if (formulaType === "tiered_percentage") {
    const config = formulaConfig as { baseField: CommissionBaseField; tiers: CommissionTier[] }
    const tierSummary = config.tiers
      .map((tier) => {
        const upper = tier.max == null ? "+" : `-${tier.max.toLocaleString("en-US")}`
        return `${tier.min.toLocaleString("en-US")}${upper} => ${tier.value}%`
      })
      .join(", ")
    return `Tiered ${config.baseField}: ${tierSummary}`
  }

  const config = formulaConfig as {
    baseField: CommissionBaseField
    threshold: number
    bonusType: "percentage" | "fixed"
    value: number
  }
  return `${config.bonusType === "percentage" ? `${config.value}%` : config.value.toLocaleString("en-US")} bonus after ${config.baseField} reaches ${config.threshold.toLocaleString("en-US")}`
}

export function buildRulePreview(rule: Pick<CommissionRulePayload, "eventType" | "appliesToRole" | "conditions" | "formulaType" | "formulaConfig">) {
  const eventLabel =
    rule.eventType === "sale_based"
      ? "sales"
      : rule.eventType === "payment_based"
        ? "payments"
        : "completed treatments"
  const roleLabel = rule.appliesToRole || "matching staff"
  const scopeLabel =
    rule.conditions.serviceNames.length > 0
      ? `${rule.conditions.serviceNames.length} selected service${rule.conditions.serviceNames.length === 1 ? "" : "s"}`
      : rule.conditions.categoryNames.length > 0
        ? `${rule.conditions.categoryNames.length} categor${rule.conditions.categoryNames.length === 1 ? "y" : "ies"}`
        : "all eligible services"

  return `For ${eventLabel}, ${roleLabel} receive ${formatCommissionFormulaSummary(rule.formulaType, rule.formulaConfig)} across ${scopeLabel}.`
}

export function buildCommissionRuleDraft(input: {
  merchantId: string
  merchantName: string
  clinicId: string
  branches: CommissionBranchOption[]
  defaultBranchId?: string
}): CommissionRulePayload {
  const defaultBranch =
    (input.defaultBranchId ? input.branches.find((branch) => branch.id === input.defaultBranchId) : null) ?? input.branches[0]

  return {
    clinicId: input.clinicId,
    merchantId: input.merchantId,
    merchantName: input.merchantName,
    branchIds: defaultBranch ? [defaultBranch.id] : [],
    branchCodes: defaultBranch ? [defaultBranch.code] : [],
    ruleName: "",
    description: "",
    status: "draft",
    appliesToRole: "salesperson",
    appliesToStaffIds: [],
    eventType: "sale_based",
    conditions: {
      branchIds: defaultBranch ? [defaultBranch.id] : [],
      branchCodes: defaultBranch ? [defaultBranch.code] : [],
      categoryNames: [],
      serviceNames: [],
      itemTypes: [],
      paymentStatuses: [],
    },
    formulaType: "percentage_of_amount",
    formulaConfig: {
      baseField: "netAmount",
      value: 5,
    },
    priority: 100,
    effectiveFrom: startOfMonth(),
    effectiveTo: "",
  }
}

export function mapRuleToPayload(rule: CommissionRule, clinicId: string): CommissionRulePayload {
  return {
    clinicId,
    merchantId: rule.merchantId,
    merchantName: rule.merchantName,
    branchIds: rule.branchIds,
    branchCodes: rule.branchCodes,
    ruleName: rule.ruleName,
    description: rule.description,
    status: rule.status,
    appliesToRole: rule.appliesToRole || "",
    appliesToStaffIds: rule.appliesToStaffIds,
    eventType: rule.eventType,
    conditions: rule.conditions,
    formulaType: rule.formulaType,
    formulaConfig: rule.formulaConfig,
    priority: rule.priority,
    effectiveFrom: rule.effectiveFrom || "",
    effectiveTo: rule.effectiveTo || "",
  }
}

export function deriveSupportedRoles(eventType: CommissionEventType) {
  if (eventType === "treatment_completed_based") {
    return ["practitioner"]
  }

  return ["salesperson"]
}

export function filterStaffOptions(options: CommissionSourceOptions | null, eventType: CommissionEventType) {
  if (!options) {
    return []
  }

  return options.staff.filter((staff) => staff.eventTypes.includes(eventType))
}
