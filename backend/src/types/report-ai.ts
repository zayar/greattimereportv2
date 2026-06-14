export const GT_GROWTH_AI_FEATURE_GATE = "gt_growth_ai" as const;

export type ReportAiReportType = "daily_appointment" | "daily_payment" | "weekly_summary";

export type ReportAiCategory =
  | "revenue"
  | "appointment"
  | "customer"
  | "package"
  | "staff"
  | "operations"
  | "risk"
  | "opportunity";

export type ReportAiSeverity = "info" | "warning" | "critical" | "success";

export type ReportAiConfidence = "low" | "medium" | "high";

export interface ReportAiEvidenceItem {
  label: string;
  value: string | number;
  comparison?: string;
}

export interface ReportAiInsight {
  id: string;
  reportType: ReportAiReportType;
  category: ReportAiCategory;
  severity: ReportAiSeverity;
  title: string;
  summary: string;
  evidence: ReportAiEvidenceItem[];
  recommendedAction: string;
  estimatedImpact?: string;
  confidence: ReportAiConfidence;
  createdAt: string;
}

export interface ReportNextAction {
  id: string;
  priority: "high" | "medium" | "low";
  actionType:
    | "call_customer"
    | "send_reminder"
    | "promote_time_slot"
    | "review_staff_utilization"
    | "follow_up_payment"
    | "rebook_customer"
    | "review_revenue_drop";
  title: string;
  description: string;
  reason: string;
  suggestedOwner?: string;
  dueDate?: string;
}

export type ReportBusinessOpportunityType =
  | "revenue_growth"
  | "package_sales"
  | "rebooking"
  | "collection"
  | "schedule_utilization"
  | "staff_performance"
  | "customer_retention";

export interface ReportBusinessOpportunity {
  id: string;
  reportType: ReportAiReportType;
  title: string;
  summary: string;
  opportunityType: ReportBusinessOpportunityType;
  estimatedValue?: number;
  estimatedValueLabel?: string;
  currency?: string;
  confidence: ReportAiConfidence;
  evidence: ReportAiEvidenceItem[];
  recommendedAction: string;
}

export interface ReportPremiumTeaser {
  insightCount?: number;
  opportunityCount?: number;
  estimatedOpportunityLabel?: string;
}

export interface ReportPremiumAccess {
  feature: typeof GT_GROWTH_AI_FEATURE_GATE;
  enabled: boolean;
  title: string;
  message: string;
  upgradeMessage?: string;
  lockedReason?: string;
  teaser?: ReportPremiumTeaser;
}

export interface ReportAiPayload {
  featureGate: typeof GT_GROWTH_AI_FEATURE_GATE;
  isPremiumFeature: true;
  entitlementChecked: boolean;
  generatedAt: string;
  summary: string;
  insights: ReportAiInsight[];
  nextActions: ReportNextAction[];
  businessOpportunity: ReportBusinessOpportunity | null;
  dataQualityNotes: string[];
}
