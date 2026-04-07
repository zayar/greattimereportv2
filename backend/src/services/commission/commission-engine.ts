import type {
  CommissionAdjustmentSnapshot,
  CommissionCalculationIssue,
  CommissionCalculationOutput,
  CommissionFormulaConfig,
  CommissionReportResultRecord,
  CommissionRuleRecord,
  CommissionRuleSnapshot,
  CommissionSourceRow,
  CommissionStaffSummary,
} from "./commission.types.js"
import {
  buildFormulaSummary,
  formatMoney,
  getSourceBaseFieldValue,
  getTierForValue,
  matchesRuleCollectionFilter,
  normalizeLower,
  normalizeRole,
  normalizeServiceAmounts,
  nowIso,
  parseNumber,
  roundMoney,
  safePercentOf,
} from "./commission.utils.js"

type CalculationInput = {
  sourceRows: CommissionSourceRow[]
  rules: CommissionRuleRecord[]
  adjustmentSnapshots: CommissionAdjustmentSnapshot[]
  filters: {
    staffIds: string[]
    staffRoles: string[]
  }
}

function overlapsRuleDate(rule: CommissionRuleRecord, eventDate: string) {
  if (rule.effectiveFrom && eventDate < rule.effectiveFrom) {
    return false
  }

  if (rule.effectiveTo && eventDate > rule.effectiveTo) {
    return false
  }

  return true
}

function matchesRule(row: CommissionSourceRow, rule: CommissionRuleRecord) {
  if (row.eventType !== rule.eventType) {
    return false
  }

  if (!overlapsRuleDate(rule, row.eventDate)) {
    return false
  }

  const branchCodes = rule.conditions.branchCodes.length > 0 ? rule.conditions.branchCodes : rule.branchCodes
  const branchMatches = branchCodes.length === 0 || matchesRuleCollectionFilter(branchCodes, row.branchCode)
  if (!branchMatches) {
    return false
  }

  const role = normalizeRole(rule.appliesToRole)
  if (role && role !== normalizeRole(row.staffRole)) {
    return false
  }

  if (rule.appliesToStaffIds.length > 0 && !rule.appliesToStaffIds.includes(row.staffId)) {
    return false
  }

  if (!matchesRuleCollectionFilter(rule.conditions.categoryNames, row.categoryName)) {
    return false
  }

  if (!matchesRuleCollectionFilter(rule.conditions.serviceNames, row.serviceName)) {
    return false
  }

  const shouldApplyItemTypeFilter = rule.formulaType !== "fixed_amount_per_service" && rule.conditions.itemTypes.length > 0
  if (
    shouldApplyItemTypeFilter &&
    (!row.itemType || !rule.conditions.itemTypes.some((itemType) => normalizeLower(itemType) === normalizeLower(row.itemType)))
  ) {
    return false
  }

  if (!matchesRuleCollectionFilter(rule.conditions.paymentStatuses, row.paymentStatus)) {
    return false
  }

  return true
}

function calculateFormula(row: CommissionSourceRow, rule: CommissionRuleRecord) {
  const summary = buildFormulaSummary(rule.formulaType, rule.formulaConfig)

  if (rule.formulaType === "percentage_of_amount") {
    const config = rule.formulaConfig as { baseField: "grossAmount" | "netAmount" | "collectedAmount"; value: number }
    if (!row.availableBaseFields.includes(config.baseField)) {
      return { skipped: `Base field ${config.baseField} is not available for ${row.eventType}.` }
    }

    const baseAmount = getSourceBaseFieldValue(row, config.baseField)
    const commissionAmount = safePercentOf(baseAmount, config.value)
    return {
      baseAmount,
      commissionAmount,
      formulaSummary: summary,
      explanation: `${rule.ruleName} v${rule.version} matched. ${config.baseField} ${formatMoney(baseAmount)} x ${config.value}% = ${formatMoney(commissionAmount)}.`,
    }
  }

  if (rule.formulaType === "fixed_amount_per_item") {
    const config = rule.formulaConfig as { value: number }
    const quantity = Math.max(1, parseNumber(row.quantity))
    const commissionAmount = roundMoney(quantity * parseNumber(config.value))
    return {
      baseAmount: roundMoney(row.netAmount),
      commissionAmount,
      formulaSummary: summary,
      explanation: `${rule.ruleName} v${rule.version} matched. ${quantity} item(s) x ${formatMoney(parseNumber(config.value))} = ${formatMoney(commissionAmount)}.`,
    }
  }

  if (rule.formulaType === "fixed_amount_per_completed_treatment") {
    const config = rule.formulaConfig as { value: number }
    const completedCount = parseNumber(row.completedTreatmentCount)
    if (completedCount <= 0) {
      return { skipped: "Completed treatment count is required for fixed treatment commission." }
    }

    const commissionAmount = roundMoney(completedCount * parseNumber(config.value))
    return {
      baseAmount: roundMoney(row.netAmount),
      commissionAmount,
      formulaSummary: summary,
      explanation: `${rule.ruleName} v${rule.version} matched. ${completedCount} completed treatment(s) x ${formatMoney(parseNumber(config.value))} = ${formatMoney(commissionAmount)}.`,
    }
  }

  if (rule.formulaType === "fixed_amount_per_service") {
    const serviceName = String(row.serviceName ?? "").trim()
    if (!serviceName) {
      return { skipped: "Service name is required for service-specific commission." }
    }

    const serviceAmount = normalizeServiceAmounts(
      "serviceAmounts" in rule.formulaConfig ? rule.formulaConfig.serviceAmounts : [],
    ).find((entry) => normalizeLower(entry.serviceName) === normalizeLower(serviceName))

    if (!serviceAmount) {
      return { skipped: `No configured service amount matched ${serviceName}.` }
    }

    const configuredAmount = parseNumber(serviceAmount.amount)
    if (configuredAmount <= 0) {
      return { skipped: `Configured service amount for ${serviceName} must be greater than 0.` }
    }

    const units =
      row.eventType === "treatment_completed_based"
        ? parseNumber(row.completedTreatmentCount)
        : Math.max(1, parseNumber(row.quantity))

    if (row.eventType === "treatment_completed_based" && units <= 0) {
      return { skipped: "Completed treatment count is required for service-specific treatment commission." }
    }

    const commissionAmount = roundMoney(units * configuredAmount)
    const rowSummary =
      units > 1
        ? `${formatMoney(configuredAmount)} per ${serviceName} x ${formatMoney(units)}`
        : `${formatMoney(configuredAmount)} for ${serviceName}`

    return {
      baseAmount: roundMoney(row.netAmount),
      commissionAmount,
      formulaSummary: rowSummary,
      explanation:
        units > 1
          ? `${rule.ruleName} v${rule.version} matched ${serviceName}. ${formatMoney(units)} service occurrence(s) x ${formatMoney(configuredAmount)} = ${formatMoney(commissionAmount)}.`
          : `${rule.ruleName} v${rule.version} matched ${serviceName}. Configured fixed amount ${formatMoney(configuredAmount)} was applied.`,
    }
  }

  if (rule.formulaType === "tiered_percentage") {
    const config = rule.formulaConfig as {
      baseField: "grossAmount" | "netAmount" | "collectedAmount"
      tiers: Array<{ min: number; max: number | null; value: number }>
    }
    if (!row.availableBaseFields.includes(config.baseField)) {
      return { skipped: `Base field ${config.baseField} is not available for ${row.eventType}.` }
    }

    const baseAmount = getSourceBaseFieldValue(row, config.baseField)
    const tier = getTierForValue(config.tiers, baseAmount)
    if (!tier) {
      return { skipped: `No tier matched ${config.baseField} ${formatMoney(baseAmount)}.` }
    }

    const commissionAmount = safePercentOf(baseAmount, tier.value)
    const tierLabel = tier.max == null ? `${formatMoney(tier.min)}+` : `${formatMoney(tier.min)}-${formatMoney(tier.max)}`
    return {
      baseAmount,
      commissionAmount,
      formulaSummary: summary,
      explanation: `${rule.ruleName} v${rule.version} matched tier ${tierLabel}. ${config.baseField} ${formatMoney(baseAmount)} x ${tier.value}% = ${formatMoney(commissionAmount)}.`,
    }
  }

  return { skipped: "Target bonus is calculated after row-level commission processing." }
}

function buildResultRecord(input: {
  row: CommissionSourceRow
  rule: CommissionRuleRecord
  baseAmount: number
  commissionAmount: number
  formulaSummary: string
  explanation: string
}): CommissionReportResultRecord {
  const { row, rule } = input

  return {
    id: `${rule.id}:${row.sourceId}`,
    runId: "",
    merchantId: row.merchantId,
    merchantName: row.merchantName,
    branchId: row.branchId,
    branchCode: row.branchCode,
    staffId: row.staffId,
    staffName: row.staffName,
    staffRole: row.staffRole,
    eventId: row.sourceId,
    sourceType: row.eventType,
    sourceDate: row.eventDate,
    ruleId: rule.id,
    ruleName: rule.ruleName,
    ruleVersion: rule.version,
    baseAmount: roundMoney(input.baseAmount),
    commissionAmount: roundMoney(input.commissionAmount),
    formulaSummary: input.formulaSummary,
    explanation: input.explanation,
    sourceRef: row.sourceRef,
    breakdown: {
      eventType: row.eventType,
      itemType: row.itemType,
      categoryName: row.categoryName,
      serviceName: row.serviceName,
      grossAmount: roundMoney(row.grossAmount),
      discountAmount: roundMoney(row.discountAmount),
      netAmount: roundMoney(row.netAmount),
      collectedAmount: roundMoney(row.collectedAmount),
      quantity: roundMoney(row.quantity),
      completedTreatmentCount: roundMoney(row.completedTreatmentCount),
      paymentStatus: row.paymentStatus,
      customerId: row.customerId,
      customerName: row.customerName,
    },
  }
}

function buildBonusResults(input: {
  sourceRows: CommissionSourceRow[]
  rules: CommissionRuleRecord[]
}) {
  const bonusResults: CommissionReportResultRecord[] = []
  const warnings: string[] = []

  const bonusRules = input.rules.filter((rule) => rule.formulaType === "target_bonus")

  for (const rule of bonusRules) {
    const config = rule.formulaConfig as {
      baseField: "grossAmount" | "netAmount" | "collectedAmount"
      threshold: number
      bonusType: "percentage" | "fixed"
      value: number
    }

    const groupedByStaff = new Map<string, CommissionSourceRow[]>()

    input.sourceRows
      .filter((row) => matchesRule(row, rule))
      .forEach((row) => {
        const existing = groupedByStaff.get(row.staffId) ?? []
        existing.push(row)
        groupedByStaff.set(row.staffId, existing)
      })

    groupedByStaff.forEach((rows, staffId) => {
      const availableRows = rows.filter((row) => row.availableBaseFields.includes(config.baseField))
      if (availableRows.length === 0) {
        warnings.push(`${rule.ruleName} skipped for ${staffId} because ${config.baseField} is unavailable.`)
        return
      }

      const baseAmount = roundMoney(
        availableRows.reduce((sum, row) => sum + getSourceBaseFieldValue(row, config.baseField), 0),
      )
      if (baseAmount < parseNumber(config.threshold)) {
        return
      }

      const commissionAmount =
        config.bonusType === "percentage" ? safePercentOf(baseAmount, config.value) : roundMoney(config.value)
      const firstRow = availableRows[0]

      bonusResults.push({
        id: `${rule.id}:bonus:${staffId}`,
        runId: "",
        merchantId: firstRow.merchantId,
        merchantName: firstRow.merchantName,
        branchId: firstRow.branchId,
        branchCode: firstRow.branchCode,
        staffId: firstRow.staffId,
        staffName: firstRow.staffName,
        staffRole: firstRow.staffRole,
        eventId: `bonus:${rule.id}:${staffId}`,
        sourceType: "target_bonus",
        sourceDate: availableRows[availableRows.length - 1]?.eventDate ?? firstRow.eventDate,
        ruleId: rule.id,
        ruleName: rule.ruleName,
        ruleVersion: rule.version,
        baseAmount,
        commissionAmount,
        formulaSummary: buildFormulaSummary(rule.formulaType, rule.formulaConfig),
        explanation:
          config.bonusType === "percentage"
            ? `${rule.ruleName} v${rule.version} bonus applied. ${config.baseField} ${formatMoney(baseAmount)} reached threshold ${formatMoney(config.threshold)}, so ${config.value}% = ${formatMoney(commissionAmount)}.`
            : `${rule.ruleName} v${rule.version} bonus applied. ${config.baseField} ${formatMoney(baseAmount)} reached threshold ${formatMoney(config.threshold)}, so fixed bonus ${formatMoney(commissionAmount)} was added.`,
        sourceRef: `bonus:${rule.id}:${staffId}`,
        breakdown: {
          eventType: rule.eventType,
          itemType: null,
          categoryName: null,
          serviceName: null,
          grossAmount: 0,
          discountAmount: 0,
          netAmount: 0,
          collectedAmount: 0,
          quantity: 0,
          completedTreatmentCount: 0,
          paymentStatus: null,
          customerId: null,
          customerName: null,
        },
      })
    })
  }

  return {
    bonusResults,
    warnings,
  }
}

function summarizeResults(results: CommissionReportResultRecord[], adjustmentSnapshots: CommissionAdjustmentSnapshot[]) {
  const staffMap = new Map<string, CommissionStaffSummary>()
  const adjustmentMap = new Map<string, number>()

  adjustmentSnapshots.forEach((adjustment) => {
    adjustmentMap.set(adjustment.staffId, roundMoney((adjustmentMap.get(adjustment.staffId) ?? 0) + adjustment.amount))
  })

  results.forEach((result) => {
    const existing =
      staffMap.get(result.staffId) ??
      ({
        staffId: result.staffId,
        staffName: result.staffName,
        staffRole: result.staffRole,
        branchCodes: [],
        baseAmount: 0,
        commissionAmount: 0,
        adjustmentAmount: 0,
        finalPayoutAmount: 0,
        transactionCount: 0,
        completedTreatmentCount: 0,
        appliedRuleNames: [],
      } satisfies CommissionStaffSummary)

    existing.branchCodes = Array.from(new Set([...existing.branchCodes, result.branchCode]))
    if (result.sourceType !== "target_bonus") {
      existing.baseAmount = roundMoney(existing.baseAmount + result.baseAmount)
      existing.transactionCount += 1
      existing.completedTreatmentCount += parseNumber(result.breakdown.completedTreatmentCount)
    }
    existing.commissionAmount = roundMoney(existing.commissionAmount + result.commissionAmount)
    existing.appliedRuleNames = Array.from(new Set([...existing.appliedRuleNames, result.ruleName]))

    staffMap.set(result.staffId, existing)
  })

  staffMap.forEach((summary, staffId) => {
    summary.adjustmentAmount = roundMoney(adjustmentMap.get(staffId) ?? 0)
    summary.finalPayoutAmount = roundMoney(summary.commissionAmount + summary.adjustmentAmount)
  })

  return [...staffMap.values()].sort((left, right) => right.finalPayoutAmount - left.finalPayoutAmount)
}

function createIssue(type: CommissionCalculationIssue["type"], row: CommissionSourceRow, message: string): CommissionCalculationIssue {
  return {
    type,
    rowId: row.sourceId,
    sourceRef: row.sourceRef,
    message,
  }
}

export function calculateCommissionReport(input: CalculationInput): CommissionCalculationOutput {
  const calculationStartedAt = nowIso()
  const filteredRows = input.sourceRows.filter((row) => {
    if (input.filters.staffIds.length > 0 && !input.filters.staffIds.includes(row.staffId)) {
      return false
    }

    if (input.filters.staffRoles.length > 0) {
      const normalizedRole = normalizeRole(row.staffRole)
      const allowed = input.filters.staffRoles.map((role) => normalizeRole(role))
      if (!allowed.includes(normalizedRole)) {
        return false
      }
    }

    return true
  })

  const ruleSnapshots: CommissionRuleSnapshot[] = input.rules.map((rule) => ({
    ...rule,
    snapshotAt: calculationStartedAt,
  }))

  const primaryRules = input.rules
    .filter((rule) => rule.formulaType !== "target_bonus")
    .sort((left, right) => right.priority - left.priority || left.ruleName.localeCompare(right.ruleName))

  const issues: CommissionCalculationIssue[] = []
  const warnings: string[] = []
  const primaryResults: CommissionReportResultRecord[] = []
  let unmatchedRowCount = 0

  filteredRows.forEach((row) => {
    const applicableRules = primaryRules.filter((rule) => matchesRule(row, rule))
    if (applicableRules.length === 0) {
      unmatchedRowCount += 1
      return
    }

    const highestPriority = applicableRules[0]?.priority ?? 0
    const topRules = applicableRules.filter((rule) => rule.priority === highestPriority)

    if (topRules.length > 1) {
      issues.push(
        createIssue(
          "conflict",
          row,
          `Multiple rules share priority ${highestPriority}: ${topRules.map((rule) => rule.ruleName).join(", ")}.`,
        ),
      )
      return
    }

    const selectedRule = topRules[0]
    const calculation = calculateFormula(row, selectedRule)
    if ("skipped" in calculation) {
      const skipMessage = calculation.skipped ?? "Row was skipped."
      issues.push(
        createIssue(
          skipMessage.toLowerCase().includes("required") || skipMessage.toLowerCase().includes("not available")
            ? "missing_data"
            : "skipped",
          row,
          skipMessage,
        ),
      )
      return
    }

    primaryResults.push(
      buildResultRecord({
        row,
        rule: selectedRule,
        baseAmount: calculation.baseAmount,
        commissionAmount: calculation.commissionAmount,
        formulaSummary: calculation.formulaSummary,
        explanation: calculation.explanation,
      }),
    )
  })

  const { bonusResults, warnings: bonusWarnings } = buildBonusResults({
    sourceRows: filteredRows,
    rules: input.rules,
  })

  warnings.push(...bonusWarnings)
  if (unmatchedRowCount > 0) {
    warnings.push(`${unmatchedRowCount.toLocaleString("en-US")} source rows had no matching commission rule.`)
  }

  const results = [...primaryResults, ...bonusResults]
  const staffSummaries = summarizeResults(results, input.adjustmentSnapshots)
  const totalBaseAmount = roundMoney(primaryResults.reduce((sum, result) => sum + result.baseAmount, 0))
  const totalCommissionAmount = roundMoney(results.reduce((sum, result) => sum + result.commissionAmount, 0))
  const totalAdjustmentAmount = roundMoney(
    input.adjustmentSnapshots.reduce((sum, adjustment) => sum + parseNumber(adjustment.amount), 0),
  )

  return {
    results,
    issues,
    warnings,
    assumptions: [
      "Sale and payment commissions use MainPaymentView service-line data.",
      "Treatment completed commissions use MainDataView rows where checkout evidence exists.",
      "MainDataView does not expose practitioner IDs, so practitioner staff IDs are derived from practitioner names.",
      "MainPaymentView does not expose a true payment timestamp, so payment-based rows are scoped by order date and allocated collected amount.",
      "Branch filters currently resolve through clinic codes from the selected merchant context.",
      "Service categories are heuristic buckets derived from service names because the reporting views do not expose a native category field.",
      "Product commission is not calculated in V1 because the reporting views do not expose a product line field.",
    ],
    summaryTotals: {
      totalBaseAmount,
      totalCommissionAmount,
      totalAdjustmentAmount,
      finalPayoutAmount: roundMoney(totalCommissionAmount + totalAdjustmentAmount),
      sourceRowCount: filteredRows.length,
      matchedRowCount: primaryResults.length,
      skippedRowCount: issues.length,
      conflictRowCount: issues.filter((issue) => issue.type === "conflict").length,
      missingDataRowCount: issues.filter((issue) => issue.type === "missing_data").length,
      bonusRowCount: bonusResults.length,
    },
    staffSummaries,
    ruleSnapshots,
    adjustmentSnapshots: input.adjustmentSnapshots,
  }
}
