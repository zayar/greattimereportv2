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

export interface ReportAiInsight {
  id: string;
  reportType: ReportAiReportType;
  category: ReportAiCategory;
  severity: ReportAiSeverity;
  title: string;
  summary: string;
  evidence: Array<{
    label: string;
    value: string | number;
    comparison?: string;
  }>;
  recommendedAction: string;
  estimatedImpact?: string;
  confidence: "low" | "medium" | "high";
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

export interface ReportAiPayload {
  featureGate: typeof GT_GROWTH_AI_FEATURE_GATE;
  isPremiumFeature: true;
  entitlementChecked: boolean;
  generatedAt: string;
  summary: string;
  insights: ReportAiInsight[];
  nextActions: ReportNextAction[];
  businessOpportunity: string | null;
  dataQualityNotes: string[];
}
