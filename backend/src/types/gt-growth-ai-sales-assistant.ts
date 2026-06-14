import type { ReportPremiumAccess } from "./report-ai.js";

export const gtGrowthAiSalesActionTypes = [
  "rebooking_opportunity",
  "package_usage_follow_up",
  "package_upsell_opportunity",
  "inactive_vip_follow_up",
  "payment_follow_up",
] as const;

export type GtGrowthAiSalesActionType = (typeof gtGrowthAiSalesActionTypes)[number];

export const gtGrowthAiSalesActionStatuses = [
  "new",
  "assigned",
  "contacted",
  "replied",
  "booked",
  "purchased",
  "skipped",
  "closed",
] as const;

export type GtGrowthAiSalesActionStatus = (typeof gtGrowthAiSalesActionStatuses)[number];

export const gtGrowthAiSalesActionUpdateStatuses = [
  "contacted",
  "replied",
  "booked",
  "purchased",
  "skipped",
  "closed",
] as const;

export type GtGrowthAiSalesActionUpdateStatus = (typeof gtGrowthAiSalesActionUpdateStatuses)[number];

export type GtGrowthAiActionPriority = "high" | "medium" | "low";

export type GtGrowthAiSalesActionSource =
  | "bigquery"
  | "daily_appointment_report"
  | "daily_payment_report"
  | "weekly_summary_report"
  | "customer_portal"
  | "package_portal"
  | "payment_report";

export type GtGrowthAiTelegramTargetPurpose =
  | "general_reports"
  | "owner_group"
  | "sales_lead"
  | "reception"
  | "finance"
  | "manager"
  | "other";

export const gtGrowthAiTelegramTargetPurposes = [
  "general_reports",
  "owner_group",
  "sales_lead",
  "reception",
  "finance",
  "manager",
  "other",
] as const;

export interface GtGrowthAiSalesActionEvidence {
  label: string;
  value: string | number;
  comparison?: string;
}

export interface GtGrowthAiSalesAction {
  id: string;
  clinicId: string;
  clinicCode?: string;
  dateKey: string;
  actionType: GtGrowthAiSalesActionType;
  priority: GtGrowthAiActionPriority;
  priorityScore: number;
  title: string;
  summary: string;
  reason: string;
  recommendedAction: string;
  customer?: {
    customerKey?: string;
    customerName?: string;
    phoneMasked?: string;
    memberId?: string;
  };
  evidence: GtGrowthAiSalesActionEvidence[];
  suggestedMessage?: {
    language: "my-MM" | "en-US";
    text: string;
  };
  estimatedValue?: number;
  estimatedValueLabel?: string;
  currency?: "MMK";
  source: GtGrowthAiSalesActionSource;
  assignedToTargetId?: string | null;
  assignedToChatId?: string | null;
  assignedToLabel?: string | null;
  status: GtGrowthAiSalesActionStatus;
  statusNote?: string | null;
  createdAt: string;
  updatedAt: string;
  assignedAt?: string | null;
  lastStatusAt?: string | null;
  lastStatusByTelegramUserId?: string | null;
}

export interface GtGrowthAiSalesAssistantSummary {
  totalActions: number;
  highPriorityCount: number;
  rebookingCount: number;
  packageUsageCount: number;
  packageUpsellCount: number;
  inactiveVipCount: number;
  paymentFollowUpCount: number;
  estimatedTotalValue?: number;
  estimatedTotalValueLabel?: string;
  currency?: "MMK";
}

export interface GtGrowthAiSalesAssistantProgress {
  assigned: number;
  contacted: number;
  replied: number;
  booked: number;
  purchased: number;
  skipped: number;
  closed: number;
  pending: number;
  estimatedOpportunityHandled?: number;
  estimatedOpportunityHandledLabel?: string;
  currency?: "MMK";
}

export interface GtGrowthAiSalesAssistantResponse {
  premium: ReportPremiumAccess;
  summary?: GtGrowthAiSalesAssistantSummary;
  actions?: GtGrowthAiSalesAction[];
  lockedPreview?: {
    title: string;
    message: string;
    teaserBullets: string[];
  };
}
