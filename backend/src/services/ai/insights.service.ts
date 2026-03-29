import type { ZodType } from "zod";
import { z } from "zod";
import { getCustomerPortalOverview } from "../reports/customer-portal.service.js";
import { getDashboardOverview } from "../reports/dashboard.service.js";
import { getServicePortalOverview } from "../reports/service-portal.service.js";
import { buildCorrectionPrompt, buildCustomerInsightPrompt, buildExecutiveSummaryPrompt, buildServiceInsightPrompt } from "./prompt-builders.js";
import { createAiProvider } from "./provider.js";
import { buildCustomerInsightFallback, buildExecutiveSummaryFallback, buildServiceInsightFallback } from "./fallbacks.js";
import { calculateCustomerRiskSignals } from "./customer-risk.service.js";
import type { AiLanguage } from "./language.js";
import {
  customerInsightCoreSchema,
  executiveSummaryCoreSchema,
  serviceInsightCoreSchema,
  type CustomerInsightResponse,
  type ExecutiveSummaryResponse,
  type ServiceInsightResponse,
} from "./schemas.js";

type ExecutiveSummaryRequest = {
  clinicId: string;
  clinicCode: string;
  fromDate: string;
  toDate: string;
  aiLanguage: AiLanguage;
  filters?: Record<string, unknown>;
};

type CustomerInsightRequest = {
  clinicId: string;
  clinicCode: string;
  fromDate: string;
  toDate: string;
  aiLanguage: AiLanguage;
  customerName: string;
  customerPhone: string;
};

type ServiceInsightRequest = {
  clinicId: string;
  clinicCode: string;
  fromDate: string;
  toDate: string;
  aiLanguage: AiLanguage;
  serviceName: string;
};

function sanitizeOptionalText(value: string | null | undefined) {
  const text = value?.trim() ?? "";
  return text ? text : null;
}

function stripJsonFences(payload: string) {
  return payload.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
}

function formatZodIssue(error: z.ZodError) {
  return error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ");
}

async function getStructuredAiOutput<T>(params: {
  featureName: string;
  schema: ZodType<T>;
  prompt: string;
  fallbackReason: string;
}): Promise<{ data: T | null; modelName: string; fallbackReason: string | null }> {
  const provider = createAiProvider();

  if (!provider) {
    return {
      data: null,
      modelName: "gemini-fallback",
      fallbackReason: params.fallbackReason,
    };
  }

  const attempts = [params.prompt];
  let lastValidationIssue = "";

  for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
    try {
      const raw = await provider.generateJson(attempts[attemptIndex]);
      const parsedJson = JSON.parse(stripJsonFences(raw)) as unknown;
      const parsed = params.schema.safeParse(parsedJson);

      if (parsed.success) {
        return {
          data: parsed.data,
          modelName: provider.modelName,
          fallbackReason: null,
        };
      }

      lastValidationIssue = formatZodIssue(parsed.error);
      if (attemptIndex === 0) {
        attempts.push(
          buildCorrectionPrompt({
            originalPrompt: params.prompt,
            invalidResponse: raw,
            validationIssue: lastValidationIssue,
          }),
        );
      }
    } catch (error) {
      lastValidationIssue = error instanceof Error ? error.message : "Unknown AI provider error.";
      if (attemptIndex === 0) {
        attempts.push(
          buildCorrectionPrompt({
            originalPrompt: params.prompt,
            invalidResponse: lastValidationIssue,
            validationIssue: "The response could not be parsed as valid JSON.",
          }),
        );
      }
    }
  }

  return {
    data: null,
    modelName: provider.modelName,
    fallbackReason: lastValidationIssue || params.fallbackReason,
  };
}

function logAiFeature(params: {
  featureName: string;
  clinicId: string;
  aiLanguage: AiLanguage;
  modelName: string;
  durationMs: number;
  success: boolean;
  usedFallback: boolean;
  failureReason: string | null;
}) {
  console.info("[GT_V2Report][AI]", {
    featureName: params.featureName,
    clinicId: params.clinicId,
    aiLanguage: params.aiLanguage,
    modelName: params.modelName,
    durationMs: params.durationMs,
    success: params.success,
    usedFallback: params.usedFallback,
    failureReason: params.failureReason,
  });
}

export async function generateExecutiveSummary(
  params: ExecutiveSummaryRequest,
): Promise<ExecutiveSummaryResponse> {
  const startedAt = Date.now();
  const generatedAt = new Date().toISOString();
  const dashboard = await getDashboardOverview({
    clinicCode: params.clinicCode,
    fromDate: params.fromDate,
    toDate: params.toDate,
  });

  const prompt = buildExecutiveSummaryPrompt({
    aiLanguage: params.aiLanguage,
    facts: {
      clinicId: params.clinicId,
      dateRange: {
        fromDate: params.fromDate,
        toDate: params.toDate,
      },
      filters: params.filters ?? {},
      summary: dashboard.summary,
      topServices: dashboard.topServices.slice(0, 3),
      paymentMix: dashboard.paymentMix.slice(0, 3),
      topTherapists: dashboard.topTherapists.slice(0, 2).map((row) => ({
        therapistName: row.therapistName,
        completedServices: row.completedServices,
      })),
    },
  });

  const aiResult = await getStructuredAiOutput({
    featureName: "executive-summary",
    schema: executiveSummaryCoreSchema,
    prompt,
    fallbackReason: "Gemini is not configured for executive summary.",
  });

  const data = aiResult.data
    ? {
        ...aiResult.data,
        topFindings: (aiResult.data.topFindings ?? []).slice(0, 3),
        recommendedActions: (aiResult.data.recommendedActions ?? []).slice(0, 3),
        warningText: sanitizeOptionalText(aiResult.data.warningText),
        languageUsed: params.aiLanguage,
        generatedAt,
      }
    : {
        ...buildExecutiveSummaryFallback({
          aiLanguage: params.aiLanguage,
          dashboard,
        }),
        languageUsed: params.aiLanguage,
        generatedAt,
      };

  logAiFeature({
    featureName: "executive-summary",
    clinicId: params.clinicId,
    aiLanguage: params.aiLanguage,
    modelName: aiResult.modelName,
    durationMs: Date.now() - startedAt,
    success: aiResult.data != null,
    usedFallback: aiResult.data == null,
    failureReason: aiResult.fallbackReason,
  });

  return data;
}

export async function generateCustomerInsight(
  params: CustomerInsightRequest,
): Promise<CustomerInsightResponse> {
  const startedAt = Date.now();
  const generatedAt = new Date().toISOString();
  const overview = await getCustomerPortalOverview({
    clinicCode: params.clinicCode,
    fromDate: params.fromDate,
    toDate: params.toDate,
    customerName: params.customerName,
    customerPhone: params.customerPhone,
  });

  const customer = overview.customer;
  const riskSignals = calculateCustomerRiskSignals({
    totalVisits: customer.totalVisits,
    daysSinceLastVisit: customer.daysSinceLastVisit,
    avgVisitGapDays:
      customer.totalVisits >= 2 && customer.avgVisitIntervalDays != null && customer.avgVisitIntervalDays > 0
        ? customer.avgVisitIntervalDays
        : null,
    remainingSessions: customer.remainingSessions,
    recent3MonthVisits: customer.recent3MonthVisits,
    previous3MonthVisits: customer.previous3MonthVisits,
  });

  const prompt = buildCustomerInsightPrompt({
    aiLanguage: params.aiLanguage,
    facts: {
      customer: {
        preferredService: customer.preferredService,
        preferredServiceCategory: customer.preferredServiceCategory,
        preferredTherapist: customer.preferredTherapist,
        spendTier: customer.spendTier,
        totalVisits: customer.totalVisits,
        lastPaymentMethod: customer.lastPaymentMethod,
        remainingSessions: customer.remainingSessions,
      },
      deterministicSignals: riskSignals,
      recentTrend: {
        recent3MonthVisits: customer.recent3MonthVisits,
        previous3MonthVisits: customer.previous3MonthVisits,
      },
      insightRules: overview.insights.slice(0, 3).map((insight) => ({
        title: insight.title,
        detail: insight.detail,
      })),
    },
  });

  const aiResult = await getStructuredAiOutput({
    featureName: "customer-insight",
    schema: customerInsightCoreSchema,
    prompt,
    fallbackReason: "Gemini is not configured for customer insight.",
  });

  const fallback = buildCustomerInsightFallback({
    aiLanguage: params.aiLanguage,
    overview,
    riskSignals,
  });

  const aiCopy = aiResult.data ?? fallback;

  const response: CustomerInsightResponse = {
    churnRiskLevel: riskSignals.churnRiskLevel,
    rebookingStatus: riskSignals.rebookingStatus,
    healthScore: riskSignals.healthScore,
    nextBestAction: aiCopy.nextBestAction,
    shortExplanation: aiCopy.shortExplanation,
    suggestedFollowUpMessage: sanitizeOptionalText(aiCopy.suggestedFollowUpMessage),
    languageUsed: params.aiLanguage,
    generatedAt,
  };

  logAiFeature({
    featureName: "customer-insight",
    clinicId: params.clinicId,
    aiLanguage: params.aiLanguage,
    modelName: aiResult.modelName,
    durationMs: Date.now() - startedAt,
    success: aiResult.data != null,
    usedFallback: aiResult.data == null,
    failureReason: aiResult.fallbackReason,
  });

  return response;
}

export async function generateServiceInsight(
  params: ServiceInsightRequest,
): Promise<ServiceInsightResponse> {
  const startedAt = Date.now();
  const generatedAt = new Date().toISOString();
  const overview = await getServicePortalOverview({
    clinicCode: params.clinicCode,
    fromDate: params.fromDate,
    toDate: params.toDate,
    serviceName: params.serviceName,
  });

  const service = overview.service;
  const prompt = buildServiceInsightPrompt({
    aiLanguage: params.aiLanguage,
    facts: {
      service: {
        serviceName: service.serviceName,
        serviceCategory: service.serviceCategory,
        revenue: service.totalRevenue,
        bookings: service.bookingCount,
        customerCount: service.customerCount,
        repeatRate: service.repeatPurchaseRate,
        averageSellingPrice: service.averageSellingPrice,
        growthRate: service.growthRate,
        packageMixPct: service.packageMixPct,
        topTherapist: service.topTherapist,
        topTherapistShare: service.topTherapistShare,
        averageDiscountRate: service.averageDiscountRate,
      },
      relatedServices: overview.relatedServices.slice(0, 4),
      therapistPerformance: overview.therapistPerformance.slice(0, 3).map((row) => ({
        therapistName: row.therapistName,
        bookingCount: row.bookingCount,
      })),
      existingInsights: overview.insights.slice(0, 3).map((insight) => ({
        title: insight.title,
        detail: insight.detail,
      })),
    },
  });

  const aiResult = await getStructuredAiOutput({
    featureName: "service-insight",
    schema: serviceInsightCoreSchema,
    prompt,
    fallbackReason: "Gemini is not configured for service insight.",
  });

  const fallback = buildServiceInsightFallback({
    aiLanguage: params.aiLanguage,
    overview,
  });

  const aiCopy = aiResult.data ?? fallback;

  const response: ServiceInsightResponse = {
    ...aiCopy,
    recommendedActions: (aiCopy.recommendedActions ?? []).slice(0, 3),
    staffingObservation: sanitizeOptionalText(aiCopy.staffingObservation),
    languageUsed: params.aiLanguage,
    generatedAt,
  };

  logAiFeature({
    featureName: "service-insight",
    clinicId: params.clinicId,
    aiLanguage: params.aiLanguage,
    modelName: aiResult.modelName,
    durationMs: Date.now() - startedAt,
    success: aiResult.data != null,
    usedFallback: aiResult.data == null,
    failureReason: aiResult.fallbackReason,
  });

  return response;
}
