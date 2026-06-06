import { z } from "zod";
import type { AiLanguage } from "./language.js";

export const customerRelationshipRiskLevels = ["low", "medium", "high"] as const;
export const customerRelationshipSegments = [
  "package_bought_never_came",
  "package_bought_not_used",
  "unused_package_balance",
  "inactive_vip",
  "treatment_due",
  "overdue_customer",
  "high_value_no_recent_visit",
  "new_customer_no_second_visit",
  "declining_frequency",
  "loyal_vip",
  "healthy_active_customer",
] as const;
export const customerRelationshipIntents = [
  "package_bought_never_came",
  "package_bought_not_used",
  "unused_package_balance",
  "follow_up_today",
  "inactive_vip",
  "churn_risk",
  "treatment_due",
  "high_value_no_recent_visit",
  "customer_search",
  "general_summary",
  "unsupported",
] as const;
export const customerRelationshipFeedbackOutcomes = [
  "called",
  "messaged",
  "booked",
  "replied",
  "no_reply",
  "not_interested",
  "wrong_number",
  "other",
] as const;
export const customerRelationshipFollowUpTones = ["friendly", "professional", "soft", "promotion"] as const;

export type CustomerRelationshipRiskLevel = (typeof customerRelationshipRiskLevels)[number];
export type CustomerRelationshipSegment = (typeof customerRelationshipSegments)[number];
export type CustomerRelationshipIntent = (typeof customerRelationshipIntents)[number];
export type CustomerRelationshipFeedbackOutcome = (typeof customerRelationshipFeedbackOutcomes)[number];
export type CustomerRelationshipFollowUpTone = (typeof customerRelationshipFollowUpTones)[number];
export type CustomerRelationshipRebookingStatus = "onTrack" | "dueSoon" | "overdue" | "unknown";

export type CustomerRelationshipPackageHolding = {
  serviceName: string;
  packageName: string | null;
  serviceCategory: string;
  packageTotal: number;
  usedCount: number;
  remainingCount: number;
  latestUsageDate: string | null;
  latestTherapist: string | null;
};

export type CustomerRelationshipPackagePurchase = {
  serviceName: string;
  packageName: string | null;
  serviceCategory: string;
  purchaseCount: number;
  latestPurchaseDate: string | null;
  totalAmount: number;
};

export type CustomerRelationshipServiceUsage = {
  serviceName: string;
  serviceCategory: string;
  counts: number[];
  totalUsage: number;
};

export type CustomerRelationshipProfile = {
  clinicId: string;
  clinicCode: string;
  customerKey: string;
  customerName: string;
  customerPhoneMasked: string;
  customerPhoneDigitsHash?: string;
  memberId?: string | null;
  firstSeenDate: string | null;
  lastVisitDate: string | null;
  daysSinceLastVisit: number | null;
  lastPaymentDate: string | null;
  lastPackagePurchaseDate: string | null;
  lastPackageServiceName: string | null;
  lastPackageName: string | null;
  totalVisits: number;
  lifetimeSpend: number;
  averageSpend: number;
  recent90DayVisits: number;
  previous90DayVisits: number;
  preferredService: string | null;
  preferredServiceCategory: string | null;
  preferredTherapist: string | null;
  preferredDayOfWeek: string | null;
  preferredHour: number | null;
  lastService: string | null;
  lastPaymentMethod: string | null;
  packagePurchaseCount: number;
  activePackageCount: number;
  totalPackageSessions: number;
  usedPackageSessions: number;
  remainingPackageSessions: number;
  packageHoldings: CustomerRelationshipPackageHolding[];
  packagePurchases: CustomerRelationshipPackagePurchase[];
  serviceUsageByMonth: CustomerRelationshipServiceUsage[];
  packageBoughtNeverCame: boolean;
  packageBoughtButNoUsage: boolean;
  hasUnusedPackageBalance: boolean;
  relationshipHealthScore: number;
  riskLevel: CustomerRelationshipRiskLevel;
  rebookingStatus: CustomerRelationshipRebookingStatus;
  segments: CustomerRelationshipSegment[];
  reasons: string[];
  nextBestAction: string;
  priorityScore: number;
  lastFollowUpAt: string | null;
  lastFollowUpOutcome: string | null;
  followUpCount: number;
  lastMatchedAt?: string | null;
  lastMatchedIntent?: CustomerRelationshipIntent | null;
  learnedAt: string;
  sourceLookbackDays: number;
};

export type CustomerRelationshipLearningSummary = {
  learnedAt: string;
  totalCustomersAnalyzed: number;
  profilesSaved: number;
  highRiskCount: number;
  mediumRiskCount: number;
  lowRiskCount: number;
  segmentCounts: Record<string, number>;
};

export type CustomerRelationshipAgentRow = {
  customerKey: string;
  customerName: string;
  customerPhoneMasked: string;
  lastVisitDate: string | null;
  daysSinceLastVisit: number | null;
  lastService: string | null;
  lastPackageServiceName: string | null;
  lastPackageName: string | null;
  remainingPackageSessions: number;
  packageHoldings: CustomerRelationshipPackageHolding[];
  packagePurchases: CustomerRelationshipPackagePurchase[];
  lifetimeSpend: number;
  riskLevel: CustomerRelationshipRiskLevel;
  segments: CustomerRelationshipSegment[];
  reasons: string[];
  nextBestAction: string;
  priorityScore: number;
  lastFollowUpAt: string | null;
  lastFollowUpOutcome: string | null;
  followUpCount: number;
};

export type CustomerRelationshipAgentResponse = {
  detectedIntent: CustomerRelationshipIntent;
  answerSummary: string;
  matchedCount: number;
  recommendedActions: string[];
  rows: CustomerRelationshipAgentRow[];
  dataFreshnessNote: string;
  learnedAt: string | null;
  sourceLookbackDays: number | null;
  suggestions?: string[];
  usedFallback: boolean;
};

export type CustomerRelationshipFollowUpMessage = {
  message: string;
  reason: string;
  customerName: string;
  segments: CustomerRelationshipSegment[];
  languageUsed: AiLanguage;
  usedFallback: boolean;
};

export const customerRelationshipAgentAnswerSchema = z.object({
  answerSummary: z.string().min(1).max(520),
  recommendedActions: z.array(z.string().min(1).max(180)).max(4).default([]),
});

export const customerRelationshipFollowUpMessageSchema = z.object({
  message: z.string().min(1).max(360),
  reason: z.string().min(1).max(220),
});

export type CustomerRelationshipAgentAnswerCore = z.infer<typeof customerRelationshipAgentAnswerSchema>;
export type CustomerRelationshipFollowUpMessageCore = z.infer<typeof customerRelationshipFollowUpMessageSchema>;
