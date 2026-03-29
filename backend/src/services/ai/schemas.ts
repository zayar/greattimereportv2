import { z } from "zod";
import type { AiLanguage } from "./language.js";

export type ChurnRiskLevel = "low" | "medium" | "high";
export type RebookingStatus = "dueSoon" | "overdue" | "onTrack" | "unknown";

export const executiveSummaryCoreSchema = z.object({
  summaryTitle: z.string().min(1).max(120),
  summaryText: z.string().min(1).max(360),
  topFindings: z.array(z.string().min(1).max(180)).max(3).default([]),
  recommendedActions: z.array(z.string().min(1).max(180)).max(3).default([]),
  warningText: z.string().min(1).max(180).nullable().optional(),
});

export const customerInsightCoreSchema = z.object({
  nextBestAction: z.string().min(1).max(180),
  shortExplanation: z.string().min(1).max(360),
  suggestedFollowUpMessage: z.string().min(1).max(180).nullable().optional(),
});

export const serviceInsightCoreSchema = z.object({
  shortSummary: z.string().min(1).max(180),
  growthInsight: z.string().min(1).max(180),
  repeatRateInsight: z.string().min(1).max(180),
  packageOpportunity: z.string().min(1).max(180),
  staffingObservation: z.string().min(1).max(180).nullable().optional(),
  recommendedActions: z.array(z.string().min(1).max(180)).max(3).default([]),
});

export type ExecutiveSummaryCore = z.infer<typeof executiveSummaryCoreSchema>;
export type CustomerInsightCore = z.infer<typeof customerInsightCoreSchema>;
export type ServiceInsightCore = z.infer<typeof serviceInsightCoreSchema>;

export type ExecutiveSummaryResponse = ExecutiveSummaryCore & {
  languageUsed: AiLanguage;
  generatedAt: string;
};

export type CustomerInsightResponse = {
  churnRiskLevel: ChurnRiskLevel;
  rebookingStatus: RebookingStatus;
  healthScore: number;
  nextBestAction: string;
  shortExplanation: string;
  suggestedFollowUpMessage: string | null;
  languageUsed: AiLanguage;
  generatedAt: string;
};

export type ServiceInsightResponse = ServiceInsightCore & {
  languageUsed: AiLanguage;
  generatedAt: string;
};
