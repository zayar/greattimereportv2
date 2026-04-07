import { firestoreDb } from "../../config/firebase.js"
import type {
  CommissionAdjustmentRecord,
  CommissionReportResultRecord,
  CommissionRuleRecord,
  CommissionRuleSnapshot,
  CommissionRuleWriteInput,
  CommissionRunRecord,
} from "./commission.types.js"
import {
  normalizeConditions,
  normalizeFormulaConfig,
  normalizeRole,
  normalizeText,
  nowIso,
  parseNumber,
} from "./commission.utils.js"

const RULES_COLLECTION = "commission_rules"
const RUNS_COLLECTION = "commission_report_runs"
const RESULTS_COLLECTION = "commission_report_results"
const ADJUSTMENTS_COLLECTION = "commission_adjustments"
const RULE_VERSION_SUBCOLLECTION = "versions"

function rulesCollection() {
  return firestoreDb().collection(RULES_COLLECTION)
}

function runsCollection() {
  return firestoreDb().collection(RUNS_COLLECTION)
}

function resultsCollection() {
  return firestoreDb().collection(RESULTS_COLLECTION)
}

function adjustmentsCollection() {
  return firestoreDb().collection(ADJUSTMENTS_COLLECTION)
}

function normalizeRuleRecord(id: string, data: Record<string, unknown> | undefined): CommissionRuleRecord {
  const conditions = normalizeConditions((data?.conditions as Record<string, unknown> | undefined) ?? {})

  return {
    id,
    merchantId: normalizeText(data?.merchantId),
    merchantName: normalizeText(data?.merchantName),
    branchIds: Array.isArray(data?.branchIds) ? data?.branchIds.map(normalizeText).filter(Boolean) : [],
    branchCodes: Array.isArray(data?.branchCodes) ? data?.branchCodes.map(normalizeText).filter(Boolean) : [],
    ruleName: normalizeText(data?.ruleName),
    description: normalizeText(data?.description),
    status:
      data?.status === "draft" || data?.status === "active" || data?.status === "archived" ? data.status : "draft",
    appliesToRole: normalizeText(data?.appliesToRole) || null,
    appliesToStaffIds: Array.isArray(data?.appliesToStaffIds)
      ? data?.appliesToStaffIds.map(normalizeText).filter(Boolean)
      : [],
    eventType:
      data?.eventType === "sale_based" ||
      data?.eventType === "payment_based" ||
      data?.eventType === "treatment_completed_based"
        ? data.eventType
        : "sale_based",
    conditions,
    formulaType:
      data?.formulaType === "percentage_of_amount" ||
      data?.formulaType === "fixed_amount_per_item" ||
      data?.formulaType === "fixed_amount_per_completed_treatment" ||
      data?.formulaType === "fixed_amount_per_service" ||
      data?.formulaType === "tiered_percentage" ||
      data?.formulaType === "target_bonus"
        ? data.formulaType
        : "percentage_of_amount",
    formulaConfig: normalizeFormulaConfig(
      (data?.formulaType === "percentage_of_amount" ||
      data?.formulaType === "fixed_amount_per_item" ||
      data?.formulaType === "fixed_amount_per_completed_treatment" ||
      data?.formulaType === "fixed_amount_per_service" ||
      data?.formulaType === "tiered_percentage" ||
      data?.formulaType === "target_bonus"
        ? data.formulaType
        : "percentage_of_amount") as CommissionRuleRecord["formulaType"],
      ((data?.formulaConfig as CommissionRuleRecord["formulaConfig"] | undefined) ?? {
        baseField: "netAmount",
        value: 0,
      }) as CommissionRuleRecord["formulaConfig"],
      conditions.serviceNames,
    ),
    priority: parseNumber(data?.priority),
    effectiveFrom: normalizeText(data?.effectiveFrom) || null,
    effectiveTo: normalizeText(data?.effectiveTo) || null,
    version: Math.max(1, parseNumber(data?.version) || 1),
    createdAt: normalizeText(data?.createdAt) || nowIso(),
    updatedAt: normalizeText(data?.updatedAt) || nowIso(),
    createdByUserId: normalizeText(data?.createdByUserId) || null,
    createdByEmail: normalizeText(data?.createdByEmail) || null,
    updatedByUserId: normalizeText(data?.updatedByUserId) || null,
    updatedByEmail: normalizeText(data?.updatedByEmail) || null,
  }
}

function normalizeRunRecord(id: string, data: Record<string, unknown> | undefined): CommissionRunRecord {
  return {
    id,
    merchantId: normalizeText(data?.merchantId),
    merchantName: normalizeText(data?.merchantName),
    branchIds: Array.isArray(data?.branchIds) ? data?.branchIds.map(normalizeText).filter(Boolean) : [],
    branchCodes: Array.isArray(data?.branchCodes) ? data?.branchCodes.map(normalizeText).filter(Boolean) : [],
    dateFrom: normalizeText(data?.dateFrom),
    dateTo: normalizeText(data?.dateTo),
    monthKey: normalizeText(data?.monthKey),
    generatedAt: normalizeText(data?.generatedAt) || nowIso(),
    generatedByUserId: normalizeText(data?.generatedByUserId) || null,
    generatedByEmail: normalizeText(data?.generatedByEmail) || null,
    status:
      data?.status === "running" || data?.status === "completed" || data?.status === "failed"
        ? data.status
        : "running",
    selectedRuleIds: Array.isArray(data?.selectedRuleIds) ? data?.selectedRuleIds.map(normalizeText).filter(Boolean) : [],
    ruleSnapshots: Array.isArray(data?.ruleSnapshots) ? (data?.ruleSnapshots as CommissionRuleSnapshot[]) : [],
    summaryTotals:
      (data?.summaryTotals as CommissionRunRecord["summaryTotals"] | undefined) ?? {
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
    staffSummaries: Array.isArray(data?.staffSummaries)
      ? (data?.staffSummaries as CommissionRunRecord["staffSummaries"])
      : [],
    adjustmentSnapshots: Array.isArray(data?.adjustmentSnapshots)
      ? (data?.adjustmentSnapshots as CommissionRunRecord["adjustmentSnapshots"])
      : [],
    filters:
      (data?.filters as CommissionRunRecord["filters"] | undefined) ?? {
        branchIds: [],
        branchCodes: [],
        staffIds: [],
        staffRoles: [],
      },
    warnings: Array.isArray(data?.warnings) ? data?.warnings.map(normalizeText).filter(Boolean) : [],
    assumptions: Array.isArray(data?.assumptions) ? data?.assumptions.map(normalizeText).filter(Boolean) : [],
    resultCount: parseNumber(data?.resultCount),
    errorMessage: normalizeText(data?.errorMessage) || null,
  }
}

function normalizeAdjustmentRecord(id: string, data: Record<string, unknown> | undefined): CommissionAdjustmentRecord {
  return {
    id,
    clinicId: normalizeText(data?.clinicId),
    merchantId: normalizeText(data?.merchantId),
    merchantName: normalizeText(data?.merchantName),
    monthKey: normalizeText(data?.monthKey),
    staffId: normalizeText(data?.staffId),
    staffName: normalizeText(data?.staffName),
    amount: parseNumber(data?.amount),
    reason: normalizeText(data?.reason),
    createdAt: normalizeText(data?.createdAt) || nowIso(),
    createdByUserId: normalizeText(data?.createdByUserId) || null,
    createdByEmail: normalizeText(data?.createdByEmail) || null,
  }
}

async function writeRuleVersionSnapshot(rule: CommissionRuleRecord) {
  await rulesCollection()
    .doc(rule.id)
    .collection(RULE_VERSION_SUBCOLLECTION)
    .doc(`v${rule.version}`)
    .set({
      ...rule,
      versionRole: normalizeRole(rule.appliesToRole),
      snapshotAt: nowIso(),
    })
}

export async function listCommissionRules(merchantId: string) {
  const snapshot = await rulesCollection().where("merchantId", "==", merchantId).get()
  return snapshot.docs
    .map((doc) => normalizeRuleRecord(doc.id, doc.data()))
    .sort((left, right) => {
      const updatedCompare = right.updatedAt.localeCompare(left.updatedAt)
      if (updatedCompare !== 0) {
        return updatedCompare
      }
      return right.priority - left.priority
    })
}

export async function getCommissionRule(ruleId: string) {
  const snapshot = await rulesCollection().doc(ruleId).get()
  if (!snapshot.exists) {
    return null
  }

  return normalizeRuleRecord(snapshot.id, snapshot.data())
}

export async function createCommissionRule(input: CommissionRuleWriteInput, actor: { userId?: string; email?: string }) {
  const createdAt = nowIso()
  const docRef = rulesCollection().doc()
  const rule: CommissionRuleRecord = {
    id: docRef.id,
    merchantId: input.merchantId,
    merchantName: input.merchantName,
    branchIds: input.branchIds,
    branchCodes: input.branchCodes,
    ruleName: input.ruleName,
    description: input.description,
    status: input.status,
    appliesToRole: input.appliesToRole,
    appliesToStaffIds: input.appliesToStaffIds,
    eventType: input.eventType,
    conditions: normalizeConditions(input.conditions),
    formulaType: input.formulaType,
    formulaConfig: normalizeFormulaConfig(input.formulaType, input.formulaConfig, input.conditions.serviceNames),
    priority: input.priority,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
    version: 1,
    createdAt,
    updatedAt: createdAt,
    createdByUserId: normalizeText(actor.userId) || null,
    createdByEmail: normalizeText(actor.email) || null,
    updatedByUserId: normalizeText(actor.userId) || null,
    updatedByEmail: normalizeText(actor.email) || null,
  }

  await docRef.set(rule)
  await writeRuleVersionSnapshot(rule)
  return rule
}

export async function updateCommissionRule(
  ruleId: string,
  input: CommissionRuleWriteInput,
  actor: { userId?: string; email?: string },
) {
  const existing = await getCommissionRule(ruleId)
  if (!existing) {
    return null
  }

  const updatedRule: CommissionRuleRecord = {
    ...existing,
    merchantId: input.merchantId,
    merchantName: input.merchantName,
    branchIds: input.branchIds,
    branchCodes: input.branchCodes,
    ruleName: input.ruleName,
    description: input.description,
    status: input.status,
    appliesToRole: input.appliesToRole,
    appliesToStaffIds: input.appliesToStaffIds,
    eventType: input.eventType,
    conditions: normalizeConditions(input.conditions),
    formulaType: input.formulaType,
    formulaConfig: normalizeFormulaConfig(input.formulaType, input.formulaConfig, input.conditions.serviceNames),
    priority: input.priority,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
    version: existing.version + 1,
    updatedAt: nowIso(),
    updatedByUserId: normalizeText(actor.userId) || null,
    updatedByEmail: normalizeText(actor.email) || null,
  }

  await rulesCollection().doc(ruleId).set(updatedRule)
  await writeRuleVersionSnapshot(updatedRule)
  return updatedRule
}

export async function duplicateCommissionRule(ruleId: string, actor: { userId?: string; email?: string }) {
  const existing = await getCommissionRule(ruleId)
  if (!existing) {
    return null
  }

  return createCommissionRule(
    {
      merchantId: existing.merchantId,
      merchantName: existing.merchantName,
      branchIds: existing.branchIds,
      branchCodes: existing.branchCodes,
      ruleName: `${existing.ruleName} Copy`,
      description: existing.description,
      status: "draft",
      appliesToRole: existing.appliesToRole,
      appliesToStaffIds: existing.appliesToStaffIds,
      eventType: existing.eventType,
      conditions: existing.conditions,
      formulaType: existing.formulaType,
      formulaConfig: existing.formulaConfig,
      priority: existing.priority,
      effectiveFrom: existing.effectiveFrom,
      effectiveTo: existing.effectiveTo,
    },
    actor,
  )
}

export async function archiveCommissionRule(ruleId: string, actor: { userId?: string; email?: string }) {
  const existing = await getCommissionRule(ruleId)
  if (!existing) {
    return null
  }

  return updateCommissionRule(
    ruleId,
    {
      merchantId: existing.merchantId,
      merchantName: existing.merchantName,
      branchIds: existing.branchIds,
      branchCodes: existing.branchCodes,
      ruleName: existing.ruleName,
      description: existing.description,
      status: "archived",
      appliesToRole: existing.appliesToRole,
      appliesToStaffIds: existing.appliesToStaffIds,
      eventType: existing.eventType,
      conditions: existing.conditions,
      formulaType: existing.formulaType,
      formulaConfig: existing.formulaConfig,
      priority: existing.priority,
      effectiveFrom: existing.effectiveFrom,
      effectiveTo: existing.effectiveTo,
    },
    actor,
  )
}

export async function listCommissionAdjustments(merchantId: string, clinicId?: string, monthKey?: string) {
  const snapshot = await adjustmentsCollection().where("merchantId", "==", merchantId).get()
  return snapshot.docs
    .map((doc) => normalizeAdjustmentRecord(doc.id, doc.data()))
    .filter((record) => (clinicId ? record.clinicId === clinicId : true))
    .filter((record) => (monthKey ? record.monthKey === monthKey : true))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export async function createCommissionAdjustment(
  input: Omit<CommissionAdjustmentRecord, "id" | "createdAt" | "createdByUserId" | "createdByEmail">,
  actor: { userId?: string; email?: string },
) {
  const createdAt = nowIso()
  const docRef = adjustmentsCollection().doc()
  const adjustment: CommissionAdjustmentRecord = {
    id: docRef.id,
    clinicId: input.clinicId,
    merchantId: input.merchantId,
    merchantName: input.merchantName,
    monthKey: input.monthKey,
    staffId: input.staffId,
    staffName: input.staffName,
    amount: input.amount,
    reason: input.reason,
    createdAt,
    createdByUserId: normalizeText(actor.userId) || null,
    createdByEmail: normalizeText(actor.email) || null,
  }

  await docRef.set(adjustment)
  return adjustment
}

export async function createCommissionRun(run: CommissionRunRecord) {
  await runsCollection().doc(run.id).set(run)
}

export async function updateCommissionRun(runId: string, update: Partial<CommissionRunRecord>) {
  await runsCollection().doc(runId).set(update, { merge: true })
}

export async function createCommissionRunId() {
  return runsCollection().doc().id
}

export async function saveCommissionResults(results: CommissionReportResultRecord[]) {
  const chunkSize = 400

  for (let index = 0; index < results.length; index += chunkSize) {
    const batch = firestoreDb().batch()
    for (const result of results.slice(index, index + chunkSize)) {
      batch.set(resultsCollection().doc(result.id), result)
    }
    await batch.commit()
  }
}

export async function listCommissionRuns(merchantId: string, monthKey?: string) {
  const snapshot = await runsCollection().where("merchantId", "==", merchantId).get()
  return snapshot.docs
    .map((doc) => normalizeRunRecord(doc.id, doc.data()))
    .filter((run) => (monthKey ? run.monthKey === monthKey : true))
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))
}

export async function getCommissionRun(runId: string) {
  const snapshot = await runsCollection().doc(runId).get()
  if (!snapshot.exists) {
    return null
  }

  return normalizeRunRecord(snapshot.id, snapshot.data())
}

export async function getCommissionResults(runId: string) {
  const snapshot = await resultsCollection().where("runId", "==", runId).get()
  return snapshot.docs
    .map((doc) => doc.data() as CommissionReportResultRecord)
    .sort((left, right) => {
      const staffCompare = left.staffName.localeCompare(right.staffName)
      if (staffCompare !== 0) {
        return staffCompare
      }
      return left.sourceDate.localeCompare(right.sourceDate)
    })
}
