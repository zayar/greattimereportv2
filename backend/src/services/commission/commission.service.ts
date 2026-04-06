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
  CommissionGenerateInput,
  CommissionRuleWriteInput,
  CommissionRunRecord,
} from "./commission.types.js"
import { monthKeyFromDate, nowIso, normalizeText } from "./commission.utils.js"

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

export async function getCommissionRules(merchantId: string) {
  return listCommissionRules(merchantId)
}

export async function saveCommissionRule(input: {
  ruleId?: string
  rule: CommissionRuleWriteInput
  actor: { userId?: string; email?: string }
}) {
  if (input.ruleId) {
    const updated = await updateCommissionRule(input.ruleId, input.rule, input.actor)
    if (!updated) {
      throw new HttpError(404, "Commission rule not found.")
    }
    return updated
  }

  return createCommissionRule(input.rule, input.actor)
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

export async function addCommissionAdjustment(input: {
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
  const activeRules = (await listCommissionRules(input.merchantId)).filter(
    (rule) => rule.status === "active" && ruleOverlapsDateRange(rule, input.fromDate, input.toDate),
  )

  if (activeRules.length === 0) {
    throw new HttpError(400, "No active commission rules overlap the selected date range.")
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
    const adjustmentSnapshots = mapAdjustmentSnapshots(await listCommissionAdjustments(input.merchantId, monthKey))

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

export async function getCommissionReportRuns(input: { merchantId: string; monthKey?: string }) {
  return listCommissionRuns(input.merchantId, input.monthKey)
}

export async function getCommissionRunDetail(runId: string) {
  const run = await getCommissionRun(runId)
  if (!run) {
    throw new HttpError(404, "Commission report run not found.")
  }

  const results = await getCommissionResults(runId)
  return {
    run,
    results,
  }
}
