import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { verifyFirebaseToken } from "../middleware/auth.js";
import { requireClinicAccess } from "../middleware/clinic-access.js";
import { isAiControlPanelAdminEmail } from "../services/ai-control-panel-access.service.js";
import { requireAiAgentMonitoringAdmin } from "../services/ai-agent-monitoring-access.service.js";
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
  customerRelationshipIntents,
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
  getAgentStatusReport,
  normalizeAgentStatusRange,
} from "../services/agent-hub/monitoring/agent-status-monitoring.js";
import {
  getAiAgentMonitoringLive,
  getAiAgentMonitoringRunDetail,
  getAiAgentMonitoringRuns,
  getAiAgentMonitoringSummary,
  normalizeAiAgentMonitoringRange,
  redactMonitoringText,
} from "../services/agent-hub/monitoring/agent-monitoring.service.js";
import { saveAgentRunTrace } from "../services/agent-hub/trace.repository.js";
import { nowIso } from "../services/agent-hub/safety.js";
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
  intent: optionalEmptyString(z.enum(customerRelationshipIntents)),
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

const agentStatusQuerySchema = z.object({
  clinicId: z.string().min(1).optional(),
  range: z.preprocess((value) => normalizeAgentStatusRange(value), z.enum(["1h", "24h", "7d", "30d"]).default("24h")),
  includeDetails: z
    .preprocess((value) => {
      if (typeof value !== "string") {
        return value;
      }

      return value.trim().toLowerCase() === "true";
    }, z.boolean())
    .default(false),
});

const monitoringChannelSchema = z.enum(["web", "telegram", "system", "unknown"]);

const monitoringQuerySchema = z.object({
  clinicId: z.string().min(1).optional(),
  range: z.preprocess((value) => normalizeAiAgentMonitoringRange(value), z.enum(["1h", "24h", "7d", "30d"]).default("24h")),
  channel: optionalEmptyString(monitoringChannelSchema),
  agent: optionalEmptyString(z.string().min(1)),
  status: optionalEmptyString(z.string().min(1)),
  search: z.string().optional(),
});

const monitoringRunsQuerySchema = monitoringQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: optionalEmptyString(z.string().min(1)),
});

const monitoringRunParamsSchema = z.object({
  runId: z.string().min(1),
});

router.use(verifyFirebaseToken);

export function canAccessAgentStatus(params: {
  user?: Express.Request["user"];
  clinicId?: string;
}) {
  if (!params.user) {
    return false;
  }

  if (params.clinicId) {
    return params.user.clinicIds.includes(params.clinicId);
  }

  return isAiControlPanelAdminEmail(params.user.email) || params.user.roles.includes("admin");
}

function requireAgentStatusAccess(req: Express.Request, clinicId?: string) {
  if (!req.user) {
    throw new HttpError(401, "User session is required.");
  }

  if (canAccessAgentStatus({ user: req.user, clinicId })) {
    return;
  }

  throw new HttpError(
    403,
    clinicId ? "You do not have access to this clinic." : "Cross-clinic AI status is restricted to admins.",
  );
}

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
      const data = buildLockedAgentHubResponse({
        request: params,
        premium,
      });
      const createdAt = nowIso();
      await saveAgentRunTrace({
        runId: data.requestId,
        clinicId: params.clinicId,
        clinicCode: params.clinicCode ?? null,
        clinicName: null,
        userId: req.user?.userId ?? req.user?.uid ?? "unknown",
        userEmail: req.user?.email ?? null,
        sessionId: data.sessionId,
        requestId: data.requestId,
        responseId: data.responseId,
        status: "completed",
        currentStep: "Feature locked response",
        channel: "web",
        questionPreview: redactMonitoringText(params.message, 500),
        answerPreview: redactMonitoringText(data.assistantMessage, 500),
        requestedAgent: data.requestedAgent,
        resolvedAgent: data.resolvedAgent,
        intent: data.intent,
        toolNames: [],
        sourceStatuses: data.sources.map((source) => source.dataStatus),
        dataStatus: data.dataStatus,
        fallbackUsed: true,
        deterministicResponseUsed: true,
        totalLatencyMs: 0,
        createdAt,
        updatedAt: createdAt,
        completedAt: createdAt,
        timeline: [
          {
            label: "Feature locked response",
            status: "completed",
            at: createdAt,
          },
        ],
      }).catch((error) => {
        console.warn("[ai-routes] failed to write locked Agent Hub trace", error);
      });
      res.json({
        success: true,
        data,
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
        channel: "web",
      },
    });

    res.json({ success: true, data });
  }),
);

router.get(
  "/agent/monitoring/summary",
  asyncHandler(async (req, res) => {
    await requireAiAgentMonitoringAdmin(req);
    const params = monitoringQuerySchema.parse(req.query);
    const data = await getAiAgentMonitoringSummary({
      range: params.range,
      filters: {
        clinicId: params.clinicId,
        channel: params.channel,
        agent: params.agent,
        status: params.status,
        search: params.search,
      },
    });

    res.json({ success: true, data });
  }),
);

router.get(
  "/agent/monitoring/runs",
  asyncHandler(async (req, res) => {
    await requireAiAgentMonitoringAdmin(req);
    const params = monitoringRunsQuerySchema.parse(req.query);
    const data = await getAiAgentMonitoringRuns({
      range: params.range,
      filters: {
        clinicId: params.clinicId,
        channel: params.channel,
        agent: params.agent,
        status: params.status,
        search: params.search,
      },
      limit: params.limit,
      cursor: params.cursor,
    });

    res.json({ success: true, data });
  }),
);

router.get(
  "/agent/monitoring/live",
  asyncHandler(async (req, res) => {
    await requireAiAgentMonitoringAdmin(req);
    const params = monitoringQuerySchema.parse(req.query);
    const data = await getAiAgentMonitoringLive({
      filters: {
        clinicId: params.clinicId,
        channel: params.channel,
        agent: params.agent,
        status: params.status,
        search: params.search,
      },
    });

    res.json({ success: true, data });
  }),
);

router.get(
  "/agent/monitoring/runs/:runId",
  asyncHandler(async (req, res) => {
    await requireAiAgentMonitoringAdmin(req);
    const params = monitoringRunParamsSchema.parse(req.params);
    const data = await getAiAgentMonitoringRunDetail({
      runId: params.runId,
    });

    if (!data) {
      throw new HttpError(404, "Agent run was not found.");
    }

    res.json({ success: true, data });
  }),
);

router.get(
  "/agent/status",
  asyncHandler(async (req, res) => {
    const params = agentStatusQuerySchema.parse(req.query);
    requireAgentStatusAccess(req, params.clinicId);
    const data = await getAgentStatusReport({
      clinicId: params.clinicId,
      range: params.range,
      includeDetails: params.includeDetails,
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
