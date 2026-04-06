import { Router } from "express"
import { z } from "zod"
import { verifyFirebaseToken } from "../middleware/auth.js"
import { requireClinicAccess } from "../middleware/clinic-access.js"
import { asyncHandler } from "../utils/async-handler.js"
import { HttpError } from "../utils/http-error.js"
import {
  addCommissionAdjustment,
  copyCommissionRule,
  disableCommissionRule,
  generateCommissionReport,
  getCommissionOptions,
  getCommissionReportRuns,
  getCommissionRules,
  getCommissionRunDetail,
  saveCommissionRule,
} from "../services/commission/commission.service.js"

const router = Router()

const stringArrayQuerySchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => {
    if (!value) {
      return []
    }

    const values = Array.isArray(value) ? value : value.split(",")
    return values.map((entry) => entry.trim()).filter(Boolean)
  })

const bodyStringArraySchema = z.array(z.string()).default([])

const conditionsSchema = z.object({
  branchIds: bodyStringArraySchema,
  branchCodes: bodyStringArraySchema,
  categoryNames: bodyStringArraySchema,
  serviceNames: bodyStringArraySchema,
  itemTypes: z.array(z.enum(["service", "package", "product"])).default([]),
  paymentStatuses: bodyStringArraySchema,
})

const percentageFormulaConfigSchema = z.object({
  baseField: z.enum(["grossAmount", "netAmount", "collectedAmount"]),
  value: z.coerce.number().finite(),
})

const fixedAmountConfigSchema = z.object({
  value: z.coerce.number().finite(),
})

const tieredFormulaConfigSchema = z.object({
  baseField: z.enum(["grossAmount", "netAmount", "collectedAmount"]),
  tiers: z
    .array(
      z.object({
        min: z.coerce.number().finite(),
        max: z.coerce.number().finite().nullable(),
        value: z.coerce.number().finite(),
      }),
    )
    .min(1),
})

const targetBonusFormulaConfigSchema = z.object({
  baseField: z.enum(["grossAmount", "netAmount", "collectedAmount"]),
  threshold: z.coerce.number().finite(),
  bonusType: z.enum(["percentage", "fixed"]),
  value: z.coerce.number().finite(),
})

const ruleBodySchema = z.object({
  clinicId: z.string().min(1),
  merchantId: z.string().min(1),
  merchantName: z.string().min(1),
  branchIds: bodyStringArraySchema,
  branchCodes: bodyStringArraySchema,
  ruleName: z.string().min(1),
  description: z.string().default(""),
  status: z.enum(["draft", "active", "archived"]),
  appliesToRole: z.string().default(""),
  appliesToStaffIds: bodyStringArraySchema,
  eventType: z.enum(["sale_based", "payment_based", "treatment_completed_based"]),
  conditions: conditionsSchema.default({
    branchIds: [],
    branchCodes: [],
    categoryNames: [],
    serviceNames: [],
    itemTypes: [],
    paymentStatuses: [],
  }),
  formulaType: z.enum([
    "percentage_of_amount",
    "fixed_amount_per_item",
    "fixed_amount_per_completed_treatment",
    "tiered_percentage",
    "target_bonus",
  ]),
  formulaConfig: z.union([
    percentageFormulaConfigSchema,
    fixedAmountConfigSchema,
    tieredFormulaConfigSchema,
    targetBonusFormulaConfigSchema,
  ]),
  priority: z.coerce.number().int().min(0).default(0),
  effectiveFrom: z.string().default(""),
  effectiveTo: z.string().default(""),
})

const reportGenerateSchema = z.object({
  clinicId: z.string().min(1),
  merchantId: z.string().min(1),
  merchantName: z.string().min(1),
  branchIds: bodyStringArraySchema,
  branchCodes: bodyStringArraySchema,
  fromDate: z.string().min(1),
  toDate: z.string().min(1),
  staffIds: bodyStringArraySchema,
  staffRoles: bodyStringArraySchema,
})

const adjustmentSchema = z.object({
  clinicId: z.string().min(1),
  merchantId: z.string().min(1),
  merchantName: z.string().min(1),
  monthKey: z.string().min(1),
  staffId: z.string().min(1),
  staffName: z.string().min(1),
  amount: z.coerce.number().finite(),
  reason: z.string().min(1),
})

const merchantQuerySchema = z.object({
  clinicId: z.string().min(1),
  merchantId: z.string().min(1),
  merchantName: z.string().default(""),
  branchIds: stringArrayQuerySchema,
  branchCodes: stringArrayQuerySchema,
  monthKey: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => (Array.isArray(value) ? value[0] : value)),
})

function assertBranchAccess(allowedClinicIds: string[], branchIds: string[], clinicId: string) {
  const requestedIds = branchIds.length > 0 ? branchIds : [clinicId]
  const deniedIds = requestedIds.filter((branchId) => !allowedClinicIds.includes(branchId))

  if (deniedIds.length > 0) {
    throw new HttpError(403, `You do not have access to branch scope: ${deniedIds.join(", ")}.`)
  }
}

router.use(verifyFirebaseToken)

router.get(
  "/options",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = merchantQuerySchema.parse(req.query)
    assertBranchAccess(req.user?.clinicIds ?? [], params.branchIds, params.clinicId)
    const data = await getCommissionOptions({
      merchantId: params.merchantId,
      merchantName: params.merchantName || params.merchantId,
      branchIds: params.branchIds,
      branchCodes: params.branchCodes,
    })

    res.json({ success: true, data })
  }),
)

router.get(
  "/rules",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = merchantQuerySchema.parse(req.query)
    assertBranchAccess(req.user?.clinicIds ?? [], params.branchIds, params.clinicId)
    const data = await getCommissionRules(params.merchantId)
    res.json({ success: true, data })
  }),
)

router.post(
  "/rules",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = ruleBodySchema.parse(req.body)
    assertBranchAccess(req.user?.clinicIds ?? [], params.branchIds, params.clinicId)

    const data = await saveCommissionRule({
      rule: {
        merchantId: params.merchantId,
        merchantName: params.merchantName,
        branchIds: params.branchIds,
        branchCodes: params.branchCodes,
        ruleName: params.ruleName,
        description: params.description,
        status: params.status,
        appliesToRole: params.appliesToRole || null,
        appliesToStaffIds: params.appliesToStaffIds,
        eventType: params.eventType,
        conditions: {
          ...params.conditions,
          branchIds: params.conditions.branchIds.length > 0 ? params.conditions.branchIds : params.branchIds,
          branchCodes: params.conditions.branchCodes.length > 0 ? params.conditions.branchCodes : params.branchCodes,
        },
        formulaType: params.formulaType,
        formulaConfig: params.formulaConfig,
        priority: params.priority,
        effectiveFrom: params.effectiveFrom || null,
        effectiveTo: params.effectiveTo || null,
      },
      actor: {
        userId: req.user?.userId,
        email: req.user?.email,
      },
    })

    res.json({ success: true, data })
  }),
)

router.put(
  "/rules/:ruleId",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = ruleBodySchema.parse(req.body)
    const ruleId = z.string().min(1).parse(req.params.ruleId)
    assertBranchAccess(req.user?.clinicIds ?? [], params.branchIds, params.clinicId)

    const data = await saveCommissionRule({
      ruleId,
      rule: {
        merchantId: params.merchantId,
        merchantName: params.merchantName,
        branchIds: params.branchIds,
        branchCodes: params.branchCodes,
        ruleName: params.ruleName,
        description: params.description,
        status: params.status,
        appliesToRole: params.appliesToRole || null,
        appliesToStaffIds: params.appliesToStaffIds,
        eventType: params.eventType,
        conditions: {
          ...params.conditions,
          branchIds: params.conditions.branchIds.length > 0 ? params.conditions.branchIds : params.branchIds,
          branchCodes: params.conditions.branchCodes.length > 0 ? params.conditions.branchCodes : params.branchCodes,
        },
        formulaType: params.formulaType,
        formulaConfig: params.formulaConfig,
        priority: params.priority,
        effectiveFrom: params.effectiveFrom || null,
        effectiveTo: params.effectiveTo || null,
      },
      actor: {
        userId: req.user?.userId,
        email: req.user?.email,
      },
    })

    res.json({ success: true, data })
  }),
)

router.post(
  "/rules/:ruleId/duplicate",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = z.object({ clinicId: z.string().min(1) }).parse(req.body)
    const ruleId = z.string().min(1).parse(req.params.ruleId)
    assertBranchAccess(req.user?.clinicIds ?? [], [], params.clinicId)
    const data = await copyCommissionRule(ruleId, {
      userId: req.user?.userId,
      email: req.user?.email,
    })
    res.json({ success: true, data })
  }),
)

router.post(
  "/rules/:ruleId/archive",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = z.object({ clinicId: z.string().min(1) }).parse(req.body)
    const ruleId = z.string().min(1).parse(req.params.ruleId)
    assertBranchAccess(req.user?.clinicIds ?? [], [], params.clinicId)
    const data = await disableCommissionRule(ruleId, {
      userId: req.user?.userId,
      email: req.user?.email,
    })
    res.json({ success: true, data })
  }),
)

router.post(
  "/reports/generate",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = reportGenerateSchema.parse(req.body)
    assertBranchAccess(req.user?.clinicIds ?? [], params.branchIds, params.clinicId)
    const data = await generateCommissionReport({
      merchantId: params.merchantId,
      merchantName: params.merchantName,
      branchIds: params.branchIds,
      branchCodes: params.branchCodes,
      fromDate: params.fromDate,
      toDate: params.toDate,
      staffIds: params.staffIds,
      staffRoles: params.staffRoles,
      generatedByUserId: req.user?.userId ?? null,
      generatedByEmail: req.user?.email ?? null,
    })
    res.json({ success: true, data })
  }),
)

router.get(
  "/runs",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = merchantQuerySchema.parse(req.query)
    assertBranchAccess(req.user?.clinicIds ?? [], params.branchIds, params.clinicId)
    const data = await getCommissionReportRuns({
      merchantId: params.merchantId,
      monthKey: params.monthKey,
    })
    res.json({ success: true, data })
  }),
)

router.get(
  "/runs/:runId",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = z.object({ clinicId: z.string().min(1) }).parse(req.query)
    const runId = z.string().min(1).parse(req.params.runId)
    assertBranchAccess(req.user?.clinicIds ?? [], [], params.clinicId)
    const data = await getCommissionRunDetail(runId)
    res.json({ success: true, data })
  }),
)

router.post(
  "/adjustments",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = adjustmentSchema.parse(req.body)
    assertBranchAccess(req.user?.clinicIds ?? [], [params.clinicId], params.clinicId)
    const data = await addCommissionAdjustment({
      merchantId: params.merchantId,
      merchantName: params.merchantName,
      monthKey: params.monthKey,
      staffId: params.staffId,
      staffName: params.staffName,
      amount: params.amount,
      reason: params.reason,
      actor: {
        userId: req.user?.userId,
        email: req.user?.email,
      },
    })
    res.json({ success: true, data })
  }),
)

export default router
