import { HttpError } from "../../utils/http-error.js"
import { calculateCommissionReport } from "./commission-engine.js"
import { fetchCommissionSourceOptions, fetchCommissionSourceRows } from "./commission-bigquery.repository.js"
import {
  archiveCommissionRule,
  createCommissionAdjustment,
  createCommissionRule,
  createCommissionRun,
  createCommissionRunId,
  duplicateCommissionRule,
  deleteCommissionRule as removeCommissionRule,
  getCommissionResults,
  getCommissionRun,
  listCommissionAdjustments,
  listCommissionRules,
  listCommissionRuns,
  saveCommissionResults,
  updateCommissionRule,
  updateCommissionRun,
} from "./commission-firestore.repository.js"
import type {
  CommissionAdjustmentSnapshot,
  CommissionEventType,
  CommissionGenerateInput,
  CommissionRuleRecord,
  CommissionRuleWriteInput,
  CommissionRunRecord,
} from "./commission.types.js"
import { monthKeyFromDate, normalizeFormulaConfig, nowIso, normalizeText, validateCommissionRuleWriteInput } from "./commission.utils.js"

function resolveMonthKey(fromDate: string, toDate: string) {
  const fromKey = monthKeyFromDate(fromDate)
  const toKey = monthKeyFromDate(toDate)
  return fromKey === toKey ? fromKey : `${fromKey}_to_${toKey}`
}

function ruleOverlapsDateRange(rule: {
  effectiveFrom: string | null
  effectiveTo: string | null
}, dateFrom: string, dateTo: string) {
  if (rule.effectiveFrom && rule.effectiveFrom > dateTo) {
    return false
  }

  if (rule.effectiveTo && rule.effectiveTo < dateFrom) {
    return false
  }

  return true
}

function mapAdjustmentSnapshots(adjustments: Awaited<ReturnType<typeof listCommissionAdjustments>>): CommissionAdjustmentSnapshot[] {
  const snapshotAt = nowIso()
  return adjustments.map((adjustment) => ({
    ...adjustment,
    snapshotAt,
  }))
}

function normalizeBranchScope(branchIds: string[]) {
  return Array.from(new Set(branchIds.map((branchId) => normalizeText(branchId)).filter(Boolean)))
}

function ruleMatchesBranchScope(rule: CommissionRuleRecord, branchIds: string[]) {
  const normalizedScope = normalizeBranchScope(branchIds)
  if (normalizedScope.length === 0) {
    return true
  }

  const ruleBranchIds = normalizeBranchScope(rule.branchIds)
  if (ruleBranchIds.length === 0) {
    return true
  }

  return ruleBranchIds.some((branchId) => normalizedScope.includes(branchId))
}

function runMatchesBranchScope(run: Pick<CommissionRunRecord, "branchIds">, branchIds: string[]) {
  const normalizedScope = normalizeBranchScope(branchIds)
  if (normalizedScope.length === 0) {
    return true
  }

  const runBranchIds = normalizeBranchScope(run.branchIds)
  if (runBranchIds.length === 0) {
    return false
  }

  return runBranchIds.every((branchId) => normalizedScope.includes(branchId))
}

function toTitleCase(value: string) {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ")
}

function formatEventTypeLabel(eventType: CommissionEventType) {
  if (eventType === "payment_based") {
    return "payment"
  }

  if (eventType === "treatment_completed_based") {
    return "treatment completed"
  }

  return "sale"
}

function buildFallbackRuleName(rule: Pick<CommissionRuleWriteInput, "status" | "appliesToRole" | "eventType">) {
  const roleLabel = toTitleCase(normalizeText(rule.appliesToRole) || "staff")
  const eventLabel = formatEventTypeLabel(rule.eventType)
  const prefix = rule.status === "draft" ? "Draft " : ""
  return `${prefix}${roleLabel} ${eventLabel} commission`
}

function resolveRuleName(rule: CommissionRuleWriteInput) {
  return normalizeText(rule.ruleName) || buildFallbackRuleName(rule)
}

export async function getCommissionOptions(input: {
  merchantId: string
  merchantName: string
  branchIds: string[]
  branchCodes: string[]
}) {
  return fetchCommissionSourceOptions({
    merchantId: input.merchantId,
    merchantName: input.merchantName,
    branchIds: input.branchIds,
    branchCodes: input.branchCodes,
    fromDate: "2024-01-01",
    toDate: nowIso().slice(0, 10),
  })
}

export async function getCommissionRules(input: { merchantId: string; branchIds: string[] }) {
  return (await listCommissionRules(input.merchantId)).filter((rule) => ruleMatchesBranchScope(rule, input.branchIds))
}

export async function saveCommissionRule(input: {
  ruleId?: string
  rule: CommissionRuleWriteInput
  actor: { userId?: string; email?: string }
}) {
  const normalizedRule: CommissionRuleWriteInput = {
    ...input.rule,
    ruleName: resolveRuleName(input.rule),
    conditions: {
      ...input.rule.conditions,
      itemTypes:
        input.rule.formulaType === "fixed_amount_per_service"
          ? ["service"]
          : input.rule.conditions.itemTypes,
    },
    formulaConfig: normalizeFormulaConfig(
      input.rule.formulaType,
      input.rule.formulaConfig,
      input.rule.conditions.serviceNames,
    ),
  }

  const validationErrors = validateCommissionRuleWriteInput(normalizedRule)
  if (validationErrors.length > 0) {
    throw new HttpError(400, validationErrors[0])
  }

  if (input.ruleId) {
    const updated = await updateCommissionRule(input.ruleId, normalizedRule, input.actor)
    if (!updated) {
      throw new HttpError(404, "Commission rule not found.")
    }
    return updated
  }

  return createCommissionRule(normalizedRule, input.actor)
}

export async function copyCommissionRule(ruleId: string, actor: { userId?: string; email?: string }) {
  const duplicated = await duplicateCommissionRule(ruleId, actor)
  if (!duplicated) {
    throw new HttpError(404, "Commission rule not found.")
  }
  return duplicated
}

export async function disableCommissionRule(ruleId: string, actor: { userId?: string; email?: string }) {
  const archived = await archiveCommissionRule(ruleId, actor)
  if (!archived) {
    throw new HttpError(404, "Commission rule not found.")
  }
  return archived
}

export async function permanentlyDeleteCommissionRule(ruleId: string) {
  const deleted = await removeCommissionRule(ruleId)
  if (!deleted) {
    throw new HttpError(404, "Commission rule not found.")
  }

  return deleted
}

export async function addCommissionAdjustment(input: {
  clinicId: string
  merchantId: string
  merchantName: string
  monthKey: string
  staffId: string
  staffName: string
  amount: number
  reason: string
  actor: { userId?: string; email?: string }
}) {
  return createCommissionAdjustment(
    {
      clinicId: input.clinicId,
      merchantId: input.merchantId,
      merchantName: input.merchantName,
      monthKey: input.monthKey,
      staffId: input.staffId,
      staffName: input.staffName,
      amount: input.amount,
      reason: input.reason,
    },
    input.actor,
  )
}

export async function generateCommissionReport(input: CommissionGenerateInput) {
  const monthKey = resolveMonthKey(input.fromDate, input.toDate)
  const runId = await createCommissionRunId()
  const requestedRuleIds = Array.from(new Set(input.selectedRuleIds.map((ruleId) => normalizeText(ruleId)).filter(Boolean)))
  const activeRules = (await listCommissionRules(input.merchantId)).filter(
    (rule) =>
      rule.status === "active" &&
      ruleOverlapsDateRange(rule, input.fromDate, input.toDate) &&
      ruleMatchesBranchScope(rule, input.branchIds) &&
      (requestedRuleIds.length === 0 || requestedRuleIds.includes(rule.id)),
  )

  if (activeRules.length === 0) {
    throw new HttpError(
      400,
      requestedRuleIds.length > 0
        ? "The selected commission rule is not active for the chosen clinic scope or date range."
        : "No active commission rules overlap the selected date range.",
    )
  }

  const pendingRun: CommissionRunRecord = {
    id: runId,
    merchantId: input.merchantId,
    merchantName: input.merchantName,
    branchIds: input.branchIds,
    branchCodes: input.branchCodes,
    dateFrom: input.fromDate,
    dateTo: input.toDate,
    monthKey,
    generatedAt: nowIso(),
    generatedByUserId: normalizeText(input.generatedByUserId) || null,
    generatedByEmail: normalizeText(input.generatedByEmail) || null,
    status: "running",
    selectedRuleIds: activeRules.map((rule) => rule.id),
    ruleSnapshots: [],
    summaryTotals: {
      totalBaseAmount: 0,
      totalCommissionAmount: 0,
      totalAdjustmentAmount: 0,
      finalPayoutAmount: 0,
      sourceRowCount: 0,
      matchedRowCount: 0,
      skippedRowCount: 0,
      conflictRowCount: 0,
      missingDataRowCount: 0,
      bonusRowCount: 0,
    },
    staffSummaries: [],
    adjustmentSnapshots: [],
    filters: {
      branchIds: input.branchIds,
      branchCodes: input.branchCodes,
      staffIds: input.staffIds,
      staffRoles: input.staffRoles,
    },
    warnings: [],
    assumptions: [],
    resultCount: 0,
    errorMessage: null,
  }

  await createCommissionRun(pendingRun)

  try {
    const sourceRows = await fetchCommissionSourceRows(input)
    const adjustmentSnapshots = mapAdjustmentSnapshots(await listCommissionAdjustments(input.merchantId, input.clinicId, monthKey))

    console.info("[commission] generate:start", {
      merchantId: input.merchantId,
      branchCount: input.branchCodes.length,
      ruleCount: activeRules.length,
      sourceRowCount: sourceRows.length,
      monthKey,
    })

    const calculation = calculateCommissionReport({
      sourceRows,
      rules: activeRules,
      adjustmentSnapshots,
      filters: {
        staffIds: input.staffIds,
        staffRoles: input.staffRoles,
      },
    })

    const results = calculation.results.map((result, index) => ({
      ...result,
      id: `${runId}:${index + 1}`,
      runId,
    }))

    await saveCommissionResults(results)

    const finalizedRun: Partial<CommissionRunRecord> = {
      status: "completed",
      ruleSnapshots: calculation.ruleSnapshots,
      summaryTotals: calculation.summaryTotals,
      staffSummaries: calculation.staffSummaries,
      adjustmentSnapshots: calculation.adjustmentSnapshots,
      warnings: [
        ...calculation.warnings,
        calculation.summaryTotals.conflictRowCount > 0
          ? `${calculation.summaryTotals.conflictRowCount.toLocaleString("en-US")} rows were skipped because multiple rules shared the same priority.`
          : "",
        calculation.summaryTotals.missingDataRowCount > 0
          ? `${calculation.summaryTotals.missingDataRowCount.toLocaleString("en-US")} rows were skipped because required source data was unavailable.`
          : "",
      ].filter(Boolean),
      assumptions: calculation.assumptions,
      resultCount: results.length,
      errorMessage: null,
    }

    await updateCommissionRun(runId, finalizedRun)

    console.info("[commission] generate:complete", {
      runId,
      merchantId: input.merchantId,
      resultCount: results.length,
      totalCommissionAmount: calculation.summaryTotals.totalCommissionAmount,
      skippedRowCount: calculation.summaryTotals.skippedRowCount,
    })

    return {
      run: {
        ...pendingRun,
        ...finalizedRun,
      } as CommissionRunRecord,
      results,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Commission report generation failed."
    console.error("[commission] generate:failed", {
      runId,
      merchantId: input.merchantId,
      message,
    })
    await updateCommissionRun(runId, {
      status: "failed",
      errorMessage: message,
    })
    throw error
  }
}

export async function getCommissionReportRuns(input: { merchantId: string; monthKey?: string; branchIds: string[] }) {
  return (await listCommissionRuns(input.merchantId, input.monthKey)).filter((run) => runMatchesBranchScope(run, input.branchIds))
}

export async function getCommissionRunDetail(input: { runId: string; branchIds: string[] }) {
  const runId = input.runId
  const run = await getCommissionRun(runId)
  if (!run) {
    throw new HttpError(404, "Commission report run not found.")
  }

  if (!runMatchesBranchScope(run, input.branchIds)) {
    throw new HttpError(404, "Commission report run not found in the selected clinic scope.")
  }

  const results = await getCommissionResults(runId)
  return {
    run,
    results,
  }
}
