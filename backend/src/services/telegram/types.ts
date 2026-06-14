import type { AiLanguage } from "../ai/language.js";
import type { ReportAiPayload, ReportPremiumAccess } from "../../types/report-ai.js";

export type TelegramChatType = "private" | "group" | "supergroup" | "channel";

export type TelegramConnectionStatus = "not_linked" | "pending" | "linked";
export type TelegramReportType = "appointment" | "payment" | "owner_ai" | "weekly_summary";
export type TelegramDeliveryTrigger = "manual_test" | "scheduled" | "resend";
export type TelegramDeliveryOutcome = "sent" | "failed";
export const ownerAiReportTones = ["simple", "professional", "friendly"] as const;
export type OwnerAiReportTone = (typeof ownerAiReportTones)[number];
export const ownerAiReportFocusAreas = ["appointments", "payments", "risks", "actions", "tomorrow"] as const;
export type OwnerAiReportFocusArea = (typeof ownerAiReportFocusAreas)[number];
export const DEFAULT_OWNER_AI_LANGUAGE = "my-MM" satisfies AiLanguage;
export const DEFAULT_OWNER_AI_TONE = "simple" satisfies OwnerAiReportTone;
export const DEFAULT_OWNER_AI_FOCUS_AREAS: OwnerAiReportFocusArea[] = [
  "appointments",
  "payments",
  "risks",
  "actions",
];
export const weeklySummaryDaysOfWeek = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
export type WeeklySummaryDayOfWeek = (typeof weeklySummaryDaysOfWeek)[number];
export const weeklySummarySections = [
  "appointment_summary",
  "service_summary",
  "therapist_summary",
  "payment_summary",
  "top_services",
  "busy_hours",
] as const;
export type WeeklySummarySection = (typeof weeklySummarySections)[number];
export const DEFAULT_WEEKLY_SUMMARY_DAY_OF_WEEK = "monday" satisfies WeeklySummaryDayOfWeek;
export const DEFAULT_WEEKLY_SUMMARY_SECTIONS: WeeklySummarySection[] = [...weeklySummarySections];

export interface TelegramReportSettingsRecord {
  telegramChatId: string | null;
  telegramChatType: TelegramChatType | null;
  telegramChatTitle: string | null;
  telegramLinkedAt: string | null;
  isTodayAppointmentReportEnabled: boolean;
  reportTime: string;
  isTodayPaymentReportEnabled: boolean;
  paymentReportTime: string;
  isOwnerAiReportEnabled: boolean;
  ownerAiReportTime: string;
  ownerAiLanguage: AiLanguage;
  ownerAiTone: OwnerAiReportTone;
  ownerAiFocusAreas: OwnerAiReportFocusArea[];
  ownerAiCustomInstruction: string | null;
  isWeeklySummaryReportEnabled: boolean;
  weeklySummaryReportTime: string;
  weeklySummaryDayOfWeek: WeeklySummaryDayOfWeek;
  weeklySummarySections: WeeklySummarySection[];
  timezone: string;
  lastTestSentAt: string | null;
  lastScheduledSentAt: string | null;
  lastScheduledDateKey: string | null;
  lastPaymentTestSentAt: string | null;
  lastPaymentScheduledSentAt: string | null;
  lastPaymentScheduledDateKey: string | null;
  lastOwnerAiTestSentAt: string | null;
  lastOwnerAiScheduledSentAt: string | null;
  lastOwnerAiScheduledDateKey: string | null;
  lastWeeklySummaryTestSentAt: string | null;
  lastWeeklySummaryScheduledSentAt: string | null;
  lastWeeklySummaryScheduledDateKey: string | null;
  lastAppointmentFailureAt: string | null;
  lastAppointmentFailureReason: string | null;
  lastPaymentFailureAt: string | null;
  lastPaymentFailureReason: string | null;
  lastOwnerAiFailureAt: string | null;
  lastOwnerAiFailureReason: string | null;
  lastWeeklySummaryFailureAt: string | null;
  lastWeeklySummaryFailureReason: string | null;
}

export interface TelegramTargetRecord extends TelegramReportSettingsRecord {
  clinicId: string;
  clinicCode: string;
  clinicName: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface TelegramIntegrationRecord extends TelegramReportSettingsRecord {
  clinicId: string;
  clinicCode: string;
  clinicName: string;
  pendingLinkCode: string | null;
  pendingLinkCodeExpiresAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface TelegramTargetStatus extends TelegramTargetRecord {
  targetLabel: string;
  deliveryHistory: TelegramDeliveryLogEntry[];
}

export interface TelegramIntegrationStatus extends TelegramIntegrationRecord {
  connectionStatus: TelegramConnectionStatus;
  linkedTargetLabel: string | null;
  linkedTargetCount: number;
  linkedTargets: TelegramTargetStatus[];
  botUsername: string | null;
  botUrl: string | null;
  botDeepLink: string | null;
  botGroupDeepLink: string | null;
}

export interface TelegramLinkCodeRecord {
  code: string;
  clinicId: string;
  clinicCode: string;
  clinicName: string;
  createdAt: string;
  expiresAt: string;
  createdByUserId: string | null;
  createdByEmail: string | null;
  redeemedAt: string | null;
  telegramChatId: string | null;
  telegramChatType: TelegramChatType | null;
  telegramChatTitle: string | null;
}

export interface TelegramChatTarget {
  id: string;
  type: TelegramChatType;
  title: string | null;
}

export interface TelegramDeliveryLogRecord {
  clinicId: string;
  clinicCode: string;
  clinicName: string;
  telegramChatId: string;
  reportType: TelegramReportType;
  trigger: TelegramDeliveryTrigger;
  outcome: TelegramDeliveryOutcome;
  attemptedAt: string;
  dateKey: string | null;
  timezone: string;
  appointmentCount: number | null;
  paymentCount: number | null;
  totalPaymentAmount: number | null;
  errorMessage: string | null;
}

export interface TelegramDeliveryLogEntry extends TelegramDeliveryLogRecord {
  id: string;
}

export interface TodayAppointmentReportItem {
  time: string;
  customerName: string;
  serviceName: string;
  therapistName: string;
  status: string;
}

export interface TodayAppointmentReportSummary {
  clinicName: string;
  dateKey: string;
  timezone: string;
  totalAppointments: number;
  upcomingCount: number;
  completedCount: number;
  cancelledCount: number;
  noShowCount: number;
  cancellationRatePercent: number | null;
  noShowRatePercent: number | null;
  appointments: TodayAppointmentReportItem[];
  topServices: Array<{ serviceName: string; count: number }>;
  therapistLoad: Array<{ therapistName: string; count: number }>;
  busyHours: Array<{ label: string; count: number }>;
  underutilizedHours: Array<{ label: string; count: number }>;
  completedCustomersWithoutFutureBookingCount: number | null;
  premium: ReportPremiumAccess;
  gtGrowthAi?: ReportAiPayload;
}

export interface TodayPaymentReportItem {
  time: string;
  customerName: string;
  invoiceNumber: string;
  paymentMethod: string;
  amount: number;
  sellerName: string;
}

export interface TodayPaymentReportSummary {
  clinicName: string;
  dateKey: string;
  timezone: string;
  totalPaymentAmount: number;
  paidInvoiceCount: number;
  paymentCount: number;
  averageInvoiceValue: number;
  outstandingAmount: number;
  partialPaymentInvoiceCount: number;
  previousDayTotalPaymentAmount: number | null;
  previousDayPaymentCount: number | null;
  revenueByServiceOrPackage: Array<{ name: string; count: number; amount: number }>;
  refundVoidDiscountAmount: number | null;
  payments: TodayPaymentReportItem[];
  paymentMethods: Array<{ paymentMethod: string; count: number; amount: number }>;
  sellerTotals: Array<{ sellerName: string; count: number; amount: number }>;
  premium: ReportPremiumAccess;
  gtGrowthAi?: ReportAiPayload;
}

export interface TodayOwnerAiReportSummary {
  clinicName: string;
  dateKey: string;
  timezone: string;
  appointmentReport: Omit<TodayAppointmentReportSummary, "appointments" | "gtGrowthAi" | "premium">;
  paymentReport: Omit<TodayPaymentReportSummary, "payments" | "gtGrowthAi" | "premium">;
  aiReport: {
    reportTitle: string;
    overallStatus: "good" | "normal" | "watch" | "no_data";
    summaryText: string;
    keyFindings: string[];
    risksToWatch: string[];
    recommendedActions: string[];
    tomorrowFocus: string | null;
    dataQualityNote: string | null;
  };
}

export interface WeeklySummaryAppointmentSummary {
  totalAppointments: number;
  completedAppointments: number;
  cancelledAppointments: number;
  noShowAppointments: number;
  completionRatePercent: number | null;
  cancellationRatePercent: number | null;
  noShowRatePercent: number | null;
}

export interface WeeklySummaryCountItem {
  name: string;
  count: number;
}

export interface WeeklySummaryTopServiceItem extends WeeklySummaryCountItem {
  percentage: number | null;
}

export interface WeeklySummaryPaymentMethodItem {
  paymentMethod: string;
  count: number;
  amount: number;
}

export interface WeeklySummaryBusyHourItem {
  label: string;
  count: number;
}

export interface WeeklySummaryReportSummary {
  clinicName: string;
  dateKey: string;
  weekStartDateKey: string;
  weekEndDateKey: string;
  timezone: string;
  selectedSections: WeeklySummarySection[];
  appointmentSummary: WeeklySummaryAppointmentSummary;
  serviceSummary: WeeklySummaryCountItem[];
  therapistSummary: WeeklySummaryCountItem[];
  paymentSummary: {
    totalPaymentAmount: number;
    paymentCount: number;
    paymentMethods: WeeklySummaryPaymentMethodItem[];
    previousWeekTotalPaymentAmount: number | null;
    weekOverWeekRevenueChangePercent: number | null;
  };
  topServices: WeeklySummaryTopServiceItem[];
  busyHours: WeeklySummaryBusyHourItem[];
  busyDays: WeeklySummaryBusyHourItem[];
  underutilizedDays: WeeklySummaryBusyHourItem[];
  underutilizedHours: WeeklySummaryBusyHourItem[];
  weekOverWeekAppointmentChangePercent: number | null;
  previousWeekAppointmentCount: number | null;
  previousWeekCancelledAppointments: number | null;
  packageSalesSummary: string | null;
  customerRetentionOpportunityCount: number | null;
  premium: ReportPremiumAccess;
  gtGrowthAi?: ReportAiPayload;
}
