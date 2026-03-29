import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { verifyFirebaseToken } from "../middleware/auth.js";
import { requireClinicAccess } from "../middleware/clinic-access.js";
import { asyncHandler } from "../utils/async-handler.js";
import { resolveAiLanguage } from "../services/ai/language.js";
import {
  generateCustomerInsight,
  generateExecutiveSummary,
  generateServiceInsight,
} from "../services/ai/insights.service.js";

const router = Router();

const dateScopedBaseSchema = z.object({
  clinicId: z.string().min(1),
  clinicCode: z.string().min(1),
  fromDate: z.string().min(1),
  toDate: z.string().min(1),
  aiLanguage: z.string().optional(),
});

const executiveSummarySchema = dateScopedBaseSchema
  .extend({
    filters: z.record(z.unknown()).optional(),
  })
  .transform((value) => ({
    ...value,
    aiLanguage: resolveAiLanguage(value.aiLanguage, resolveAiLanguage(env.AI_DEFAULT_LANGUAGE)),
  }));

const customerInsightSchema = dateScopedBaseSchema
  .extend({
    customerName: z.string().default(""),
    customerPhone: z.string().default(""),
  })
  .refine(
    (value) => value.customerName.trim() !== "" || value.customerPhone.trim() !== "",
    { message: "customerName or customerPhone is required" },
  )
  .transform((value) => ({
    ...value,
    aiLanguage: resolveAiLanguage(value.aiLanguage, resolveAiLanguage(env.AI_DEFAULT_LANGUAGE)),
  }));

const serviceInsightSchema = dateScopedBaseSchema
  .extend({
    serviceName: z.string().min(1),
  })
  .transform((value) => ({
    ...value,
    aiLanguage: resolveAiLanguage(value.aiLanguage, resolveAiLanguage(env.AI_DEFAULT_LANGUAGE)),
  }));

router.use(verifyFirebaseToken);

router.post(
  "/executive-summary",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = executiveSummarySchema.parse(req.body);
    const data = await generateExecutiveSummary(params);
    res.json({ success: true, data });
  }),
);

router.post(
  "/customer-insight",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = customerInsightSchema.parse(req.body);
    const data = await generateCustomerInsight(params);
    res.json({ success: true, data });
  }),
);

router.post(
  "/service-insight",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = serviceInsightSchema.parse(req.body);
    const data = await generateServiceInsight(params);
    res.json({ success: true, data });
  }),
);

export default router;
