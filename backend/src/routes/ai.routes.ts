import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { verifyFirebaseToken } from "../middleware/auth.js";
import { requireClinicAccess } from "../middleware/clinic-access.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";
import { resolveAiLanguage } from "../services/ai/language.js";
import {
  generateCustomerInsight,
  generateExecutiveSummary,
  generateServiceInsight,
} from "../services/ai/insights.service.js";
import {
  askCustomerRelationshipAgent,
  generateCustomerRelationshipFollowUpMessage,
  recordCustomerRelationshipFeedback,
} from "../services/ai/customer-relationship-agent.service.js";
import { buildCustomerRelationshipEvidence } from "../services/ai/customer-relationship-evidence.service.js";
import {
  customerRelationshipEvidenceTypes,
  customerRelationshipFeedbackOutcomes,
  customerRelationshipFollowUpTones,
  customerRelationshipSegments,
  customerRelationshipRiskLevels,
} from "../services/ai/customer-relationship-schemas.js";
import { runCustomerRelationshipLearning } from "../services/reports/customer-relationship-learning.service.js";
import {
  getLatestCustomerRelationshipLearningRun,
  searchCustomerRelationshipProfiles,
} from "../services/reports/customer-relationship-profile.repository.js";
import {
  askAgentHub,
  buildLockedAgentHubResponse,
  readAgentHubSession,
} from "../services/agent-hub/agent-hub.service.js";
import { resolveAgentClinicContext } from "../services/agent-hub/clinic-context.service.js";
import { saveAgentFeedback } from "../services/agent-hub/feedback.repository.js";
import {
  agentChatRequestSchema,
  agentFeedbackSchema,
  agentSessionParamsSchema,
} from "../services/agent-hub/schemas.js";
import { hasFeatureAccess } from "../services/feature-access.service.js";
import { GT_GROWTH_AI_FEATURE_GATE } from "../types/report-ai.js";

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

const customerRelationshipBaseSchema = z.object({
  clinicId: z.string().min(1),
  clinicCode: z.string().min(1),
});

const optionalEmptyString = (schema: z.ZodTypeAny) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), schema.optional());

const customerRelationshipLearnSchema = customerRelationshipBaseSchema
  .extend({
    aiLanguage: z.string().optional(),
    lookbackDays: z.coerce.number().int().min(30).max(730).default(365),
  })
  .transform((value) => ({
    ...value,
    aiLanguage: resolveAiLanguage(value.aiLanguage, resolveAiLanguage(env.AI_DEFAULT_LANGUAGE)),
  }));

const customerRelationshipProfilesSchema = customerRelationshipBaseSchema.extend({
  segment: optionalEmptyString(z.enum(customerRelationshipSegments)),
  riskLevel: optionalEmptyString(z.enum(customerRelationshipRiskLevels)),
  search: z.string().default(""),
  sortBy: z
    .enum(["priorityScore", "lastVisitDate", "daysSinceLastVisit", "lifetimeSpend", "remainingPackageSessions"])
    .default("priorityScore"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

const customerRelationshipAskSchema = customerRelationshipBaseSchema
  .extend({
    question: z.string().min(1).max(500),
    aiLanguage: z.string().optional(),
    autoLearnIfStale: z.coerce.boolean().default(false),
  })
  .transform((value) => ({
    ...value,
    aiLanguage: resolveAiLanguage(value.aiLanguage, resolveAiLanguage(env.AI_DEFAULT_LANGUAGE)),
  }));

const customerRelationshipFollowUpMessageSchema = customerRelationshipBaseSchema
  .extend({
    customerKey: z.string().min(1),
    aiLanguage: z.string().optional(),
    tone: z.enum(customerRelationshipFollowUpTones).default("friendly"),
  })
  .transform((value) => ({
    ...value,
    aiLanguage: resolveAiLanguage(value.aiLanguage, resolveAiLanguage(env.AI_DEFAULT_LANGUAGE)),
  }));

const customerRelationshipEvidenceSchema = customerRelationshipBaseSchema.extend({
  customerKey: z.string().min(1),
  evidenceType: z.enum(customerRelationshipEvidenceTypes).default("package_usage"),
  year: z.coerce.number().int().min(2020).max(2100).optional(),
});

const customerRelationshipFeedbackSchema = customerRelationshipBaseSchema.extend({
  customerKey: z.string().min(1),
  outcome: z.enum(customerRelationshipFeedbackOutcomes),
  note: z.string().max(500).nullable().optional(),
});

router.use(verifyFirebaseToken);

async function requireGtGrowthAi(clinicId: string) {
  const access = await hasFeatureAccess({
    clinicId,
    feature: GT_GROWTH_AI_FEATURE_GATE,
  });

  if (!access.enabled) {
    throw new HttpError(403, access.lockedReason ?? "GT Growth AI is not enabled for this clinic.", {
      premium: access,
    });
  }

  return access;
}

router.post(
  "/agent/chat",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = agentChatRequestSchema.parse(req.body);
    const premium = await hasFeatureAccess({
      clinicId: params.clinicId,
      feature: GT_GROWTH_AI_FEATURE_GATE,
    });
    if (!premium.enabled) {
      res.json({
        success: true,
        data: buildLockedAgentHubResponse({
          request: params,
          premium,
        }),
      });
      return;
    }

    const clinic = resolveAgentClinicContext({
      user: req.user,
      clinicId: params.clinicId,
      clinicCode: params.clinicCode,
    });
    const data = await askAgentHub({
      request: params,
      clinic,
      requestContext: {
        userId: req.user?.userId ?? req.user?.uid ?? "unknown",
        userEmail: req.user?.email,
        authorizationHeader: req.headers.authorization,
      },
    });

    res.json({ success: true, data });
  }),
);

router.post(
  "/agent/feedback",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = agentFeedbackSchema.parse(req.body);
    await requireGtGrowthAi(params.clinicId);
    const data = await saveAgentFeedback({
      ...params,
      userId: req.user?.userId ?? req.user?.uid ?? "unknown",
      userEmail: req.user?.email,
    });

    res.json({ success: true, data });
  }),
);

router.get(
  "/agent/session/:sessionId",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const pathParams = agentSessionParamsSchema.parse(req.params);
    const queryParams = z.object({ clinicId: z.string().min(1) }).parse(req.query);
    await requireGtGrowthAi(queryParams.clinicId);
    const data = await readAgentHubSession({
      clinicId: queryParams.clinicId,
      userId: req.user?.userId ?? req.user?.uid ?? "unknown",
      sessionId: pathParams.sessionId,
    });

    res.json({ success: true, data });
  }),
);

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

router.post(
  "/customer-relationship-agent/learn",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = customerRelationshipLearnSchema.parse(req.body);
    const data = await runCustomerRelationshipLearning({
      clinicId: params.clinicId,
      clinicCode: params.clinicCode,
      lookbackDays: params.lookbackDays,
    });

    res.json({ success: true, data });
  }),
);

router.get(
  "/customer-relationship-agent/profiles",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = customerRelationshipProfilesSchema.parse(req.query);
    const [profiles, latestRun] = await Promise.all([
      searchCustomerRelationshipProfiles(params),
      getLatestCustomerRelationshipLearningRun(params.clinicId),
    ]);

    res.json({
      success: true,
      data: {
        rows: profiles.rows,
        totalCount: profiles.totalCount,
        lastLearnedAt: latestRun?.learnedAt ?? null,
        sourceLookbackDays: latestRun?.sourceLookbackDays ?? null,
      },
    });
  }),
);

router.post(
  "/customer-relationship-agent/ask",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = customerRelationshipAskSchema.parse(req.body);
    const data = await askCustomerRelationshipAgent(params);
    res.json({ success: true, data });
  }),
);

router.post(
  "/customer-relationship-agent/follow-up-message",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = customerRelationshipFollowUpMessageSchema.parse(req.body);
    const data = await generateCustomerRelationshipFollowUpMessage(params);
    res.json({ success: true, data });
  }),
);

router.post(
  "/customer-relationship-agent/evidence",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = customerRelationshipEvidenceSchema.parse(req.body);
    const data = await buildCustomerRelationshipEvidence(params);
    res.json({ success: true, data });
  }),
);

router.post(
  "/customer-relationship-agent/feedback",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = customerRelationshipFeedbackSchema.parse(req.body);
    const data = await recordCustomerRelationshipFeedback(params);
    res.json({ success: true, data });
  }),
);

export default router;
